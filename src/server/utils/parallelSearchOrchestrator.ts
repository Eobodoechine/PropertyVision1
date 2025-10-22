// Parallel Search Orchestrator
// Coordinates parallel execution of all search levels with progressive qualification

import { BoundedQueue } from './boundedQueue';
import { redisSemaphore } from './redisSemaphore';
import { geocodeCache } from './geocodeCache';
import { GoogleMapsGeocoder } from './googleMapsGeocoder';
import { getRedisCache } from './redisCache';
import { topK } from './minHeap';
import {
  ComparableProperty,
  SubjectProperty,
  dedupeKey,
  scoreComparable,
  mergeComparables,
  detectPotentialDuplicates
} from './compScoring';
import { parallelSearchConfig } from './parallelSearchConfig';
import { VertexComparableSearchService } from '../step3-find-comparables';
import { jobLog } from '../utils/jobLogger';

export interface SearchLevelResult {
  level: number;
  rawComps: ComparableProperty[];
  searchTime: number;
  success: boolean;
  error?: string;
}

export interface ParallelSearchResult {
  qualifiedComps: ComparableProperty[];
  passLevel?: number; // Which pass succeeded (1-4), undefined if using fallback
  searchMetadata: {
    totalSearchTime: number;
    levelsRun: number[];
    earlyStopAtLevel?: number;
    totalRawComps: number;
    cacheHits: number;
    metrics: {
      [key: string]: any;
    };
  };
}

export class ParallelSearchOrchestrator {
  private vertexQueue: BoundedQueue;
  private geocodeQueue: BoundedQueue;
  private geocoder: GoogleMapsGeocoder;
  private compService: VertexComparableSearchService;
  private abortController: AbortController;
  private totalCacheHits: number = 0;

  constructor() {
    const config = parallelSearchConfig;
    this.vertexQueue = new BoundedQueue(config.vertexLocalConcurrency);
    this.geocodeQueue = new BoundedQueue(config.geocodeConcurrency);
    this.geocoder = new GoogleMapsGeocoder(process.env.GOOGLE_MAPS_API_KEY || '');
    this.compService = new VertexComparableSearchService();
    this.abortController = new AbortController();

    jobLog(`🚀 PARALLEL SEARCH ORCHESTRATOR initialized:`);
    jobLog(`   Vertex concurrency: ${config.vertexLocalConcurrency}`);
    jobLog(`   Geocode concurrency: ${config.geocodeConcurrency}`);
    jobLog(`   Levels: ${config.levels.join(',')}`);
  }

  /**
   * Execute parallel search across all configured levels
   */
  async executeParallelSearch(
    subject: SubjectProperty,
    subjectPropertyType?: string
  ): Promise<ParallelSearchResult> {
    const startTime = Date.now();
    const config = parallelSearchConfig;

    try {
      jobLog(`\n🔥 PARALLEL SEARCH START for: ${subject.address}`);
      jobLog(`   Subject: ${subject.beds}BR/${subject.baths}BA, ${subject.sqft}sqft`);
      jobLog(`   Subdivision: ${subject.subdivision || 'N/A'}`);
      jobLog(`   Running levels: ${config.levels.join(', ')}`);

      // 🔍 DEBUG: Log all input parameters
      jobLog(`🔍 DEBUG PARALLEL SEARCH INPUT:`);
      jobLog(`   subject keys: ${Object.keys(subject).join(', ')}`);
      jobLog(`   subject.address: ${subject.address}`);
      jobLog(`   subject.sqft: ${subject.sqft}`);
      jobLog(`   subject.beds: ${subject.beds}`);
      jobLog(`   subject.baths: ${subject.baths}`);
      jobLog(`   subject.yearBuilt: ${subject.yearBuilt}`);
      jobLog(`   subject.subdivision: ${subject.subdivision}`);
      jobLog(`   subject.propertyType: ${subject.propertyType}`);
      jobLog(`   subjectPropertyType param: ${subjectPropertyType}`);
      jobLog(`   config.enabled: ${config.enabled}`);
      jobLog(`   config.levels: ${JSON.stringify(config.levels)}`);
      jobLog(`   config.vertexLocalConcurrency: ${config.vertexLocalConcurrency}`);
      jobLog(`   config.vertexGlobalConcurrency: ${config.vertexGlobalConcurrency}`);

      // Reset cache hit counter for this search
      this.totalCacheHits = 0;

      // Global state
      const pools = new Map<number, ComparableProperty[]>(); // Raw results per level
      const seenComps = new Map<string, ComparableProperty>(); // Deduplicated pool
      const levelPromises: Promise<SearchLevelResult>[] = [];

      // Launch all levels immediately
      for (const level of config.levels) {
        jobLog(`   🚀 Launching Level ${level} search...`);
        const promise = this.executeLevelSearch(level, subject, subjectPropertyType);
        levelPromises.push(promise);

        // Set up handler for when this level completes
        promise.then(result => this.onLevelReady(result, pools, seenComps, subject))
          .catch(error => {
            console.error(`❌ LEVEL ${level} FATAL ERROR:`, error);
            console.error(`   Error type: ${typeof error}`);
            console.error(`   Error message: ${error instanceof Error ? error.message : String(error)}`);
            console.error(`   Error stack:`, error instanceof Error ? error.stack : 'N/A');
          });
      }

      // Wait for all levels to complete (but early exit can happen via onLevelReady)
      let results;
      try {
        results = await Promise.allSettled(levelPromises);
      } catch (error) {
        console.error(`❌ [PARALLEL_COORDINATION] ERROR in Promise.allSettled:`);
        console.error(`   Error type: ${typeof error}`);
        console.error(`   Error message: ${error instanceof Error ? error.message : String(error)}`);
        console.error(`   Error stack:`, error instanceof Error ? error.stack : 'N/A');
        console.error(`   Context: address=${subject.address}, levels=${config.levels.join(',')}`);
        throw error; // Critical - coordination failure
      }

      jobLog(`\n📊 ALL LEVELS COMPLETED:`);
      results.forEach((result, idx) => {
        const level = config.levels[idx];
        if (result.status === 'fulfilled') {
          jobLog(`   ✅ Level ${level}: ${result.value.rawComps.length} raw comps in ${result.value.searchTime}ms`);
        } else {
          jobLog(`   ❌ Level ${level}: FAILED - ${result.reason}`);
        }
      });

      // Apply progressive pass filters on complete dataset
      jobLog(`\n🔍 APPLYING PASS FILTERS - All searches complete, trying passes 1→2→3→4`);
      let finalResult;
      try {
        finalResult = await this.tryProgressivePasses(pools, seenComps, subject, config.levels);
      } catch (error) {
        console.error(`❌ [FINAL_PASS] ERROR in tryProgressivePasses:`);
        console.error(`   Error type: ${typeof error}`);
        console.error(`   Error message: ${error instanceof Error ? error.message : String(error)}`);
        console.error(`   Error stack:`, error instanceof Error ? error.stack : 'N/A');
        console.error(`   Context: address=${subject.address}, poolsSize=${pools.size}, seenCompsSize=${seenComps.size}, levels=${config.levels.join(',')}`);
        throw error; // Critical - final qualification failure
      }

      const totalTime = Date.now() - startTime;

      return {
        qualifiedComps: finalResult.comps,
        passLevel: finalResult.passLevel,
        searchMetadata: {
          totalSearchTime: totalTime,
          levelsRun: config.levels,
          totalRawComps: seenComps.size,
          cacheHits: this.totalCacheHits,
          metrics: {
            vertexQueueStats: this.vertexQueue.getStats(),
            geocodeQueueStats: this.geocodeQueue.getStats(),
          }
        }
      };

    } catch (error) {
      console.error(`❌ PARALLEL SEARCH FATAL ERROR:`, error);
      console.error(`   Error type: ${typeof error}`);
      console.error(`   Error message: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`   Error stack:`, error instanceof Error ? error.stack : 'N/A');
      throw error;
    }
  }

  /**
   * Handle when a search level completes
   */
  private async onLevelReady(
    result: SearchLevelResult,
    pools: Map<number, ComparableProperty[]>,
    seenComps: Map<string, ComparableProperty>,
    subject: SubjectProperty
  ): Promise<void> {
    try {
      jobLog(`\n✅ LEVEL ${result.level} READY - ${result.rawComps.length} raw comps`);

      // Store raw results
      pools.set(result.level, result.rawComps);

      // Early deduplication - add to global pool
      try {
        for (const comp of result.rawComps) {
          const key = dedupeKey(comp);
          if (seenComps.has(key)) {
            // Merge with existing
            const existing = seenComps.get(key)!;
            seenComps.set(key, mergeComparables(existing, comp));
          } else {
            seenComps.set(key, comp);
          }
        }
      } catch (error) {
        console.error(`❌ [DEDUPLICATION_LOOP] ERROR during early deduplication:`);
        console.error(`   Error type: ${typeof error}`);
        console.error(`   Error message: ${error instanceof Error ? error.message : String(error)}`);
        console.error(`   Error stack:`, error instanceof Error ? error.stack : 'N/A');
        console.error(`   Context: level=${result.level}, rawCompsCount=${result.rawComps.length}, currentSeenCompsSize=${seenComps.size}`);
        // Continue execution - partial deduplication is better than none
      }

      jobLog(`   📦 Total unique comps accumulated: ${seenComps.size}`);

      // Just accumulate comps - pass filters will run once after all searches complete
      jobLog(`   ℹ️  Waiting for remaining search levels... (${seenComps.size} comps so far)`)

    } catch (error) {
      console.error(`❌ ON_LEVEL_READY ERROR for level ${result.level}:`, error);
      console.error(`   Error type: ${typeof error}`);
      console.error(`   Error message: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`   Error stack:`, error instanceof Error ? error.stack : 'N/A');
      console.error(`   Context: dataVersion=${this.dataVersion}, seenComps=${seenComps.size}, pools=${pools.size}, rawComps=${result.rawComps.length}`);
    }
  }

  /**
   * Try progressive qualification passes
   * Only called once after all search levels complete
   */
  private async tryProgressivePasses(
    pools: Map<number, ComparableProperty[]>,
    seenComps: Map<string, ComparableProperty>,
    subject: SubjectProperty,
    availableLevels: number[]
  ): Promise<{ comps: ComparableProperty[]; passLevel?: number }> {
    const config = parallelSearchConfig;
    let bestResult: ComparableProperty[] = [];

    jobLog(`\n   🔄 🏁 Progressive Pass Filtering - seenComps=${seenComps.size}, levels=[${availableLevels.join(',')}]`);

    // Try each pass in order (1 → 2 → 3 → 4)
    for (const passLevel of [1, 2, 3, 4]) {
      jobLog(`   🔍 Trying Pass ${passLevel}...`);

      jobLog(`\n🎯 TRYING PASS ${passLevel}:`);

      // Get comps up to this pass level
      const compsForPass = this.getCompsUpToLevel(seenComps, passLevel);
      jobLog(`   📊 ${compsForPass.length} comps available for pass ${passLevel}`);

      if (compsForPass.length === 0) {
        jobLog(`   ⏭️  Pass ${passLevel}: No comps available`);
        continue;
      }

      // Adaptive Top-K selection with duplicate detection
      let topCandidates;
      try {
        // First, detect potential duplicates in a larger candidate set
        // We scan more candidates to understand duplicate density
        const scanSize = Math.min(compsForPass.length, config.topKPerPass * 2);
        const scanCandidates = compsForPass.slice(0, scanSize);

        // Detect how many potential duplicates exist in the scan window
        const potentialDuplicates = detectPotentialDuplicates(scanCandidates);

        // Expand selection by duplicate count, capped at 50% expansion
        const maxExpansion = Math.ceil(config.topKPerPass * 0.5);
        const expansion = Math.min(potentialDuplicates, maxExpansion);
        const adaptiveTopK = config.topKPerPass + expansion;

        if (expansion > 0) {
          jobLog(`   🔍 Detected ${potentialDuplicates} potential duplicates in scan window, expanding selection by ${expansion}`);
          jobLog(`   📊 Adaptive top-K: ${config.topKPerPass} → ${adaptiveTopK}`);
        }

        // Select top K with adaptive expansion
        topCandidates = topK(
          compsForPass,
          adaptiveTopK,
          comp => scoreComparable(comp, subject)
        );
        jobLog(`   🔝 Selected top ${topCandidates.length} candidates for geocoding (target: ${config.targetComps}, buffer: +${expansion})`);
      } catch (error) {
        console.error(`❌ [TOP_K_SELECTION] ERROR selecting top candidates:`);
        console.error(`   Error type: ${typeof error}`);
        console.error(`   Error message: ${error instanceof Error ? error.message : String(error)}`);
        console.error(`   Error stack:`, error instanceof Error ? error.stack : 'N/A');
        console.error(`   Context: passLevel=${passLevel}, compsForPassCount=${compsForPass.length}, topKPerPass=${config.topKPerPass}`);
        // Fallback to all comps if top-K selection fails
        topCandidates = compsForPass.slice(0, config.topKPerPass);
        jobLog(`   ⚠️  Using fallback: first ${topCandidates.length} comps`);
      }

      // Geocode missing lat/lon
      try {
        await this.geocodeCandidates(topCandidates, subject);
      } catch (error) {
        console.error(`❌ [GEOCODING] ERROR geocoding candidates:`);
        console.error(`   Error type: ${typeof error}`);
        console.error(`   Error message: ${error instanceof Error ? error.message : String(error)}`);
        console.error(`   Error stack:`, error instanceof Error ? error.stack : 'N/A');
        console.error(`   Context: passLevel=${passLevel}, candidatesCount=${topCandidates.length}`);
        // Continue execution - some comps may already have coordinates
      }

      // Apply pass-specific filters
      let qualified: ComparableProperty[];
      try {
        qualified = this.applyPassFilters(topCandidates, subject, passLevel);
      } catch (error) {
        console.error(`❌ [PASS_FILTERS] ERROR applying pass filters:`);
        console.error(`   Error type: ${typeof error}`);
        console.error(`   Error message: ${error instanceof Error ? error.message : String(error)}`);
        console.error(`   Error stack:`, error instanceof Error ? error.stack : 'N/A');
        console.error(`   Context: passLevel=${passLevel}, candidatesCount=${topCandidates.length}, subject={beds:${subject.beds},baths:${subject.baths},sqft:${subject.sqft}}`);
        // Return empty array if filtering fails
        qualified = [];
      }

      jobLog(`   ✅ Pass ${passLevel}: ${qualified.length} qualified comps`);

      // Adaptive minimum per pass level: L1/L2:4, L3:3, L4:2
      const minCompsByLevel: Record<number, number> = {
        1: 4,
        2: 4,
        3: 3,
        4: 2
      };
      const minComps = minCompsByLevel[passLevel] || 2;

      // Check minimum FIRST - return immediately for quality (strictest pass wins)
      if (qualified.length >= minComps) {
        // Return ALL qualified comps - no buffer, no artificial caps
        // Limits applied only at final ARV selection after deduplication
        jobLog(`   🎯 Pass ${passLevel} meets minimum (${qualified.length} ≥ ${minComps})`);
        jobLog(`   ✅ Returning ${qualified.length} comps from Pass ${passLevel} (strictest criteria)`);
        jobLog(`   📍 Comps: ${qualified.slice(0, 6).map(c => `${c.address}($${c.price ? (c.price/1000).toFixed(0) : '?'}k)`).join(', ')}${qualified.length > 6 ? ` + ${qualified.length - 6} more` : ''}`);
        return { comps: qualified, passLevel };
      }

      // Track best result only as fallback (if no pass meets minimum)
      if (qualified.length > bestResult.length) {
        bestResult = qualified;
      }
    }

    // Return best pass result (not raw union)
    if (bestResult.length > 0) {
      jobLog(`   📋 No pass met target (${config.targetComps}), returning best pass result: ${bestResult.length} comps`);
      jobLog(`   📍 Best result comps: ${bestResult.map(c => `${c.address}($${c.price ? (c.price/1000).toFixed(0) : '?'}k)`).join(', ')}`);
      return { comps: bestResult, passLevel: undefined };
    }

    // Last resort: return all comps if no passes produced any results
    const final = this.getCompsUpToLevel(seenComps, 4);
    jobLog(`   ⚠️  All passes failed, returning all ${final.length} comps as fallback`);
    jobLog(`   📍 Fallback comps: ${final.slice(0, 10).map(c => `${c.address}($${c.price ? (c.price/1000).toFixed(0) : '?'}k)`).join(', ')}${final.length > 10 ? '...' : ''}`);
    return { comps: final, passLevel: undefined };
  }

  /**
   * Execute search for a specific level
   */
  private async executeLevelSearch(
    level: number,
    subject: SubjectProperty,
    propertyType?: string
  ): Promise<SearchLevelResult> {
    const startTime = Date.now();

    try {
      jobLog(`🔍 LEVEL ${level} SEARCH STARTING...`);

      // Load cached comps from Redis (hybrid cache: junction + global comps)
      const redisCache = getRedisCache();
      const cachedRefs = await redisCache.getSubjectCompRefs(subject.address);

      let cachedComps: any[] = [];
      if (cachedRefs.length > 0) {
        jobLog(`   💾 Found ${cachedRefs.length} cached comp references`);

        // Load global comp data in parallel
        const compAddresses = cachedRefs.map(ref => ref.compAddress);
        const globalCompsMap = await redisCache.getGlobalComps(compAddresses);

        // Merge with subject-specific data (distance)
        cachedComps = cachedRefs
          .map(ref => {
            const globalData = globalCompsMap.get(ref.compAddress);
            if (globalData) {
              return {
                ...globalData,
                distanceMi: ref.distanceMi  // Subject-specific distance
              };
            }
            return null;
          })
          .filter((comp): comp is any => comp !== null);

        jobLog(`   💾 Loaded ${cachedComps.length}/${cachedRefs.length} cached comps from Redis`);

        // Track cache hits
        this.totalCacheHits += cachedComps.length;
      }

      // Acquire semaphore tokens (if multi-worker)
      const tokensNeeded = 20; // Estimate for concurrent searches per level
      await redisSemaphore.acquire('vertex', tokensNeeded, { ttlMs: 120000 });

      try {
        // Define level-specific search criteria
        const criteria = this.getLevelCriteria(level, subject.subdivision != null);

        jobLog(`   Level ${level} criteria: ${criteria.radius}mi, ${criteria.timeWindow}mo, ${criteria.maxResults} max`);

        // Execute search via bounded queue
        let result;
        try {
          result = await this.vertexQueue.run(async () => {
            return await this.compService.findComparables(
              subject.address,
              propertyType,
              criteria.maxResults,
              criteria.radius,
              criteria.timeWindow,
              {
                sqft: subject.sqft || 0,
                beds: subject.beds || 0,
                baths: subject.baths || 0,
                yearBuilt: subject.yearBuilt || 0,
              },
              { subdivision: subject.subdivision }
            );
          }, this.abortController.signal);
        } catch (error) {
          console.error(`❌ [VERTEX_QUEUE] ERROR executing Vertex API call:`);
          console.error(`   Error type: ${typeof error}`);
          console.error(`   Error message: ${error instanceof Error ? error.message : String(error)}`);
          console.error(`   Error stack:`, error instanceof Error ? error.stack : 'N/A');
          console.error(`   Context: level=${level}, address=${subject.address}, radius=${criteria.radius}, timeWindow=${criteria.timeWindow}, maxResults=${criteria.maxResults}`);
          throw error; // Re-throw to be caught by outer try-catch
        }

        const searchTime = Date.now() - startTime;

        jobLog(`✅ LEVEL ${level} SEARCH COMPLETE: ${result.comparables?.length || 0} comps in ${searchTime}ms`);

        // Merge cached comps with live search results
        const liveComps = result.comparables || [];
        const allComps = [...cachedComps, ...liveComps];

        // Deduplicate by address (prefer live comps over cached)
        const uniqueComps = new Map<string, any>();
        for (const comp of allComps) {
          const key = comp.address?.toLowerCase();
          if (key && !uniqueComps.has(key)) {
            uniqueComps.set(key, comp);
          }
        }
        const rawComps = Array.from(uniqueComps.values());

        jobLog(`   📦 Total comps: ${rawComps.length} (${liveComps.length} live + ${cachedComps.length} cached)`);

        // Update hybrid cache with new comps (fire-and-forget)
        if (liveComps.length > 0) {
          const redisCache = getRedisCache();

          // 1. Update global comp cache (canonical data)
          redisCache.setGlobalComps(liveComps).catch((err: unknown) => {
            console.error(`⚠️  Failed to update global comp cache for level ${level}:`, err);
          });

          // 2. Update subject-comp junction (references + distance)
          const compRefs = liveComps.map((comp: any) => ({
            compAddress: comp.address,
            distanceMi: comp.distanceMi || comp.distance || this.calculateDistance(subject, comp)
          }));

          redisCache.updateSubjectCompRefs(subject.address, compRefs).catch((err: unknown) => {
            console.error(`⚠️  Failed to update subject comp refs for level ${level}:`, err);
          });

          // 3. Populate geocode cache
          this.populateGeocodeCache(liveComps).catch((err: unknown) => {
            console.error(`⚠️  Failed to populate geocode cache for level ${level}:`, err);
          });
        }

        return {
          level,
          rawComps,
          searchTime,
          success: result.success
        };

      } finally {
        // Release semaphore tokens
        try {
          await redisSemaphore.release('vertex', tokensNeeded);
        } catch (error) {
          console.error(`❌ [SEMAPHORE_RELEASE] ERROR releasing Redis semaphore:`);
          console.error(`   Error type: ${typeof error}`);
          console.error(`   Error message: ${error instanceof Error ? error.message : String(error)}`);
          console.error(`   Error stack:`, error instanceof Error ? error.stack : 'N/A');
          console.error(`   Context: level=${level}, tokensNeeded=${tokensNeeded}, resource=vertex`);
          // Don't throw - semaphore cleanup failure shouldn't prevent result return
        }
      }

    } catch (error) {
      const searchTime = Date.now() - startTime;
      console.error(`❌ LEVEL ${level} SEARCH ERROR after ${searchTime}ms:`, error);
      console.error(`   Error type: ${typeof error}`);
      console.error(`   Error message: ${error instanceof Error ? error.message : String(error)}`);

      return {
        level,
        rawComps: [],
        searchTime,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Get search criteria for a level
   */
  private getLevelCriteria(level: number, hasSubdivision: boolean) {
    const criteria = {
      1: { radius: 1.0, timeWindow: 12, maxResults: 30 },
      2: { radius: 2.0, timeWindow: 15, maxResults: 40 },
      3: { radius: 3.0, timeWindow: 18, maxResults: 50 },
      4: { radius: 4.0, timeWindow: 24, maxResults: 60 },
    };

    return criteria[level as keyof typeof criteria] || criteria[1];
  }

  /**
   * Populate Redis geocode cache from comps with lat/lon
   */
  private async populateGeocodeCache(comps: any[]): Promise<void> {
    let cached = 0;
    for (const comp of comps) {
      if (comp.address && comp.lat && comp.lon) {
        try {
          await geocodeCache.set(comp.address, comp.lat, comp.lon);
          cached++;
        } catch (error) {
          console.error(`❌ Failed to cache geocode for "${comp.address}":`, error);
        }
      }
    }
    if (cached > 0) {
      jobLog(`   💾 Cached ${cached} geocodes to Redis`);
    }
  }

  /**
   * Geocode candidates in parallel
   */
  private async geocodeCandidates(
    candidates: ComparableProperty[],
    subject: SubjectProperty
  ): Promise<void> {
    // Filter for comps that need geocoding - check for truly valid coordinates
    // This catches: missing fields, null, undefined, 0, and non-numeric values
    const isValidCoordinate = (val: any): boolean => {
      return typeof val === 'number' && val !== 0 && !isNaN(val);
    };

    const toGeocode = candidates.filter(c => !isValidCoordinate(c.lat) || !isValidCoordinate(c.lon));

    if (toGeocode.length === 0) {
      jobLog(`   ✅ All candidates already have coordinates`);
      return;
    }

    jobLog(`   🗺️  Geocoding ${toGeocode.length} candidates...`);

    const geocodeTasks = toGeocode.map(comp => async () => {
      try {
        // Check cache first
        const cached = await geocodeCache.get(comp.address);
        if (cached) {
          comp.lat = cached.lat;
          comp.lon = cached.lon;
          comp.distanceMi = this.calculateDistance(subject, comp);
          return;
        }

        // Geocode via Google Maps API
        const result = await this.geocoder.geocodeAddress(comp.address);
        if (result) {
          comp.lat = result.lat;
          comp.lon = result.lon;
          comp.distanceMi = this.calculateDistance(subject, comp);
        } else {
          jobLog(`   ⚠️  Could not geocode: ${comp.address}`);
        }

      } catch (error) {
        console.error(`❌ GEOCODE ERROR for "${comp.address}":`, error);
      }
    });

    await this.geocodeQueue.runMany(geocodeTasks, this.abortController.signal);
    jobLog(`   ✅ Geocoding complete`);
  }

  /**
   * Calculate distance between subject and comp
   */
  private calculateDistance(subject: SubjectProperty, comp: ComparableProperty): number {
    if (!subject.lat || !subject.lon || !comp.lat || !comp.lon) {
      return 999; // Unknown distance
    }

    // Haversine formula
    const R = 3959; // Earth radius in miles
    const dLat = this.toRad(comp.lat - subject.lat);
    const dLon = this.toRad(comp.lon - subject.lon);

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(subject.lat)) * Math.cos(this.toRad(comp.lat)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Apply pass-specific filters
   */
  private applyPassFilters(
    candidates: ComparableProperty[],
    subject: SubjectProperty,
    passLevel: number
  ): ComparableProperty[] {
    // Define pass criteria
    const passCriteria = {
      1: { maxDistance: 1.0, bedsTolerance: 0, bathsTolerance: 0, sqftTolerance: 0.15 },
      2: { maxDistance: 2.0, bedsTolerance: 1, bathsTolerance: 0.5, sqftTolerance: 0.20 },
      3: { maxDistance: 3.0, bedsTolerance: 1, bathsTolerance: 1, sqftTolerance: 0.25 },
      4: { maxDistance: 4.0, bedsTolerance: 2, bathsTolerance: 1, sqftTolerance: 0.30 },
    };

    const criteria = passCriteria[passLevel as keyof typeof passCriteria];

    jobLog(`\n🔍 PASS ${passLevel} FILTER DIAGNOSTICS`);
    jobLog(`   Subject specs: ${subject.beds} beds, ${subject.baths} baths, ${subject.sqft} sqft`);
    jobLog(`   Criteria: maxDist=${criteria.maxDistance}mi, beds±${criteria.bedsTolerance}, baths±${criteria.bathsTolerance}, sqft±${criteria.sqftTolerance * 100}%`);
    jobLog(`   Filtering ${candidates.length} candidates...\n`);

    let passCount = 0;
    let failCount = 0;

    const filtered = candidates.filter(comp => {
      const reasons: string[] = [];

      // Distance filter
      const distanceToCheck = comp.distanceMi || (comp as any).distance;
      if (distanceToCheck && distanceToCheck > criteria.maxDistance) {
        reasons.push(`distance=${distanceToCheck.toFixed(2)}mi > ${criteria.maxDistance}mi`);
        failCount++;
        jobLog(`   ❌ ${comp.address}: ${reasons.join(', ')}`);
        return false;
      }

      // Bedroom filter
      if (subject.beds && comp.beds) {
        const bedDiff = Math.abs(comp.beds - subject.beds);
        if (bedDiff > criteria.bedsTolerance) {
          reasons.push(`beds=${comp.beds} (diff=${bedDiff} > tol=${criteria.bedsTolerance})`);
          failCount++;
          jobLog(`   ❌ ${comp.address}: ${reasons.join(', ')}`);
          return false;
        }
      }

      // Bathroom filter
      if (subject.baths && comp.baths) {
        const bathDiff = Math.abs(comp.baths - subject.baths);
        if (bathDiff > criteria.bathsTolerance) {
          reasons.push(`baths=${comp.baths} (diff=${bathDiff} > tol=${criteria.bathsTolerance})`);
          failCount++;
          jobLog(`   ❌ ${comp.address}: ${reasons.join(', ')}`);
          return false;
        }
      }

      // Sqft filter
      if (subject.sqft && comp.sqft) {
        const diff = Math.abs(comp.sqft - subject.sqft);
        const pct = diff / subject.sqft;
        if (pct > criteria.sqftTolerance) {
          reasons.push(`sqft=${comp.sqft} (diff=${pct.toFixed(1)}% > ${criteria.sqftTolerance * 100}%)`);
          failCount++;
          jobLog(`   ❌ ${comp.address}: ${reasons.join(', ')}`);
          return false;
        }
      }

      passCount++;
      jobLog(`   ✅ ${comp.address}: PASS (${comp.beds}bd/${comp.baths}ba/${comp.sqft}sf, ${distanceToCheck?.toFixed(2) || 'N/A'}mi)`);
      return true;
    });

    jobLog(`\n📊 Pass ${passLevel} results: ${passCount} passed, ${failCount} rejected\n`);
    return filtered;
  }

  /**
   * Get comps up to a specific level
   */
  private getCompsUpToLevel(seenComps: Map<string, ComparableProperty>, level: number): ComparableProperty[] {
    // Return all comps (filtering happens in applyPassFilters)
    return Array.from(seenComps.values());
  }
}
