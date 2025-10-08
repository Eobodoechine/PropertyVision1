// Parallel Search Orchestrator
// Coordinates parallel execution of all search levels with progressive qualification

import { BoundedQueue } from './boundedQueue';
import { redisSemaphore } from './redisSemaphore';
import { geocodeCache } from './geocodeCache';
import { getRedisCache } from './redisCache';
import { topK } from './minHeap';
import {
  ComparableProperty,
  SubjectProperty,
  dedupeKey,
  scoreComparable,
  mergeComparables
} from './compScoring';
import { parallelSearchConfig } from './parallelSearchConfig';
import { VertexComparableSearchService } from '../step3-find-comparables';

export interface SearchLevelResult {
  level: number;
  rawComps: ComparableProperty[];
  searchTime: number;
  success: boolean;
  error?: string;
}

export interface ParallelSearchResult {
  qualifiedComps: ComparableProperty[];
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
  private compService: VertexComparableSearchService;
  private abortController: AbortController;
  private dataVersion = 0; // Incremented when new level results land
  private lastTriedVersion: Record<number, number> = { 1: -1, 2: -1, 3: -1, 4: -1 };

  constructor() {
    const config = parallelSearchConfig;
    this.vertexQueue = new BoundedQueue(config.vertexLocalConcurrency);
    this.geocodeQueue = new BoundedQueue(config.geocodeConcurrency);
    this.compService = new VertexComparableSearchService();
    this.abortController = new AbortController();

    console.log(`🚀 PARALLEL SEARCH ORCHESTRATOR initialized:`);
    console.log(`   Vertex concurrency: ${config.vertexLocalConcurrency}`);
    console.log(`   Geocode concurrency: ${config.geocodeConcurrency}`);
    console.log(`   Levels: ${config.levels.join(',')}`);
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
      console.log(`\n🔥 PARALLEL SEARCH START for: ${subject.address}`);
      console.log(`   Subject: ${subject.beds}BR/${subject.baths}BA, ${subject.sqft}sqft`);
      console.log(`   Subdivision: ${subject.subdivision || 'N/A'}`);
      console.log(`   Running levels: ${config.levels.join(', ')}`);

      // Global state
      const pools = new Map<number, ComparableProperty[]>(); // Raw results per level
      const seenComps = new Map<string, ComparableProperty>(); // Deduplicated pool
      const levelPromises: Promise<SearchLevelResult>[] = [];

      // Launch all levels immediately
      for (const level of config.levels) {
        console.log(`   🚀 Launching Level ${level} search...`);
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

      console.log(`\n📊 ALL LEVELS COMPLETED:`);
      results.forEach((result, idx) => {
        const level = config.levels[idx];
        if (result.status === 'fulfilled') {
          console.log(`   ✅ Level ${level}: ${result.value.rawComps.length} raw comps in ${result.value.searchTime}ms`);
        } else {
          console.log(`   ❌ Level ${level}: FAILED - ${result.reason}`);
        }
      });

      // Final pass if no early exit occurred
      console.log(`\n🔍 FINAL PASS - Clean ordered pass 1→2→3→4 on all accumulated comps`);
      let finalComps;
      try {
        finalComps = await this.tryProgressivePasses(pools, seenComps, subject, config.levels, true);
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
        qualifiedComps: finalComps,
        searchMetadata: {
          totalSearchTime: totalTime,
          levelsRun: config.levels,
          totalRawComps: seenComps.size,
          cacheHits: 0, // TODO: track cache hits
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
      console.log(`\n✅ LEVEL ${result.level} READY - ${result.rawComps.length} raw comps`);

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

      console.log(`   📦 Total unique comps accumulated: ${seenComps.size}`);

      // Bump data version since new data landed
      this.dataVersion++;
      console.log(`   📊 Data version: ${this.dataVersion}`);

      // Try progressive passes based on what we have
      const availableLevels = Array.from(pools.keys()).sort();
      console.log(`   🔍 Attempting progressive passes with levels: ${availableLevels.join(',')}`);

      const qualified = await this.tryProgressivePasses(pools, seenComps, subject, availableLevels, false);

      // Note: No early exit - we always wait for all levels and run final pass
      if (qualified.length >= parallelSearchConfig.targetComps) {
        console.log(`   ℹ️  Found ${qualified.length} qualified comps (target: ${parallelSearchConfig.targetComps}), but continuing to gather all level data`);
      }

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
   */
  private async tryProgressivePasses(
    pools: Map<number, ComparableProperty[]>,
    seenComps: Map<string, ComparableProperty>,
    subject: SubjectProperty,
    availableLevels: number[],
    finalRun: boolean = false
  ): Promise<ComparableProperty[]> {
    const config = parallelSearchConfig;
    let bestResult: ComparableProperty[] = [];

    console.log(`\n   🔄 ${finalRun ? '🏁 FINAL' : '⚡ EARLY'} Progressive Pass - dataVersion=${this.dataVersion}, seenComps=${seenComps.size}, availableLevels=[${availableLevels.join(',')}]`);

    // Try each pass in order (1 → 2 → 3 → 4)
    for (const passLevel of [1, 2, 3, 4]) {
      // Skip if we've already attempted this pass at the CURRENT dataVersion (unless final run)
      if (!finalRun && this.lastTriedVersion[passLevel] === this.dataVersion) {
        console.log(`   ⏭️  Pass ${passLevel}: Skipping (already tried for dataVersion ${this.dataVersion})`);
        continue;
      }

      // Check if we have enough data for this pass
      if (!availableLevels.includes(passLevel)) {
        console.log(`   ⏭️  Pass ${passLevel}: Skipping (level not available yet)`);
        continue;
      }

      // Mark this pass as tried for the current dataVersion (only in early runs)
      if (!finalRun) {
        this.lastTriedVersion[passLevel] = this.dataVersion;
        console.log(`   🔍 Trying Pass ${passLevel} (dataVersion ${this.dataVersion})...`);
      } else {
        console.log(`   🔍 Trying Pass ${passLevel} (FINAL RUN - ignoring history)...`);
      }

      console.log(`\n🎯 TRYING PASS ${passLevel}:`);

      // Get comps up to this pass level
      const compsForPass = this.getCompsUpToLevel(seenComps, passLevel);
      console.log(`   📊 ${compsForPass.length} comps available for pass ${passLevel}`);

      if (compsForPass.length === 0) {
        console.log(`   ⏭️  Pass ${passLevel}: No comps available`);
        continue;
      }

      // Top-K selection
      let topCandidates;
      try {
        topCandidates = topK(
          compsForPass,
          config.topKPerPass,
          comp => scoreComparable(comp, subject)
        );
        console.log(`   🔝 Selected top ${topCandidates.length} candidates for geocoding`);
      } catch (error) {
        console.error(`❌ [TOP_K_SELECTION] ERROR selecting top candidates:`);
        console.error(`   Error type: ${typeof error}`);
        console.error(`   Error message: ${error instanceof Error ? error.message : String(error)}`);
        console.error(`   Error stack:`, error instanceof Error ? error.stack : 'N/A');
        console.error(`   Context: passLevel=${passLevel}, compsForPassCount=${compsForPass.length}, topKPerPass=${config.topKPerPass}`);
        // Fallback to all comps if top-K selection fails
        topCandidates = compsForPass.slice(0, config.topKPerPass);
        console.log(`   ⚠️  Using fallback: first ${topCandidates.length} comps`);
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

      console.log(`   ✅ Pass ${passLevel}: ${qualified.length} qualified comps`);

      // Track best result
      if (qualified.length > bestResult.length) {
        bestResult = qualified;
      }

      if (qualified.length >= config.targetComps) {
        console.log(`   🎯 Target met! Returning ${qualified.length} comps from Pass ${passLevel}`);
        const result = qualified.slice(0, config.targetComps);
        console.log(`   📍 Returning comps: ${result.map(c => `${c.address}($${c.price ? (c.price/1000).toFixed(0) : '?'}k)`).join(', ')}`);
        return result;
      }
    }

    // Return best pass result (not raw union)
    if (bestResult.length > 0) {
      console.log(`   📋 No pass met target (${config.targetComps}), returning best pass result: ${bestResult.length} comps`);
      console.log(`   📍 Best result comps: ${bestResult.map(c => `${c.address}($${c.price ? (c.price/1000).toFixed(0) : '?'}k)`).join(', ')}`);
      return bestResult;
    }

    // Last resort: return all comps if no passes produced any results
    const final = this.getCompsUpToLevel(seenComps, 4);
    console.log(`   ⚠️  All passes failed, returning all ${final.length} comps as fallback`);
    console.log(`   📍 Fallback comps: ${final.slice(0, 10).map(c => `${c.address}($${c.price ? (c.price/1000).toFixed(0) : '?'}k)`).join(', ')}${final.length > 10 ? '...' : ''}`);
    return final;
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
      console.log(`🔍 LEVEL ${level} SEARCH STARTING...`);

      // Load cached comps from Redis (hybrid cache: junction + global comps)
      const redisCache = getRedisCache();
      const cachedRefs = await redisCache.getSubjectCompRefs(subject.address);

      let cachedComps: any[] = [];
      if (cachedRefs.length > 0) {
        console.log(`   💾 Found ${cachedRefs.length} cached comp references`);

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

        console.log(`   💾 Loaded ${cachedComps.length}/${cachedRefs.length} cached comps from Redis`);
      }

      // Acquire semaphore tokens (if multi-worker)
      const tokensNeeded = 20; // Estimate for concurrent searches per level
      await redisSemaphore.acquire('vertex', tokensNeeded, { ttlMs: 120000 });

      try {
        // Define level-specific search criteria
        const criteria = this.getLevelCriteria(level, subject.subdivision != null);

        console.log(`   Level ${level} criteria: ${criteria.radius}mi, ${criteria.timeWindow}mo, ${criteria.maxResults} max`);

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

        console.log(`✅ LEVEL ${level} SEARCH COMPLETE: ${result.comparables?.length || 0} comps in ${searchTime}ms`);

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

        console.log(`   📦 Total comps: ${rawComps.length} (${liveComps.length} live + ${cachedComps.length} cached)`);

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
      console.log(`   💾 Cached ${cached} geocodes to Redis`);
    }
  }

  /**
   * Geocode candidates in parallel
   */
  private async geocodeCandidates(
    candidates: ComparableProperty[],
    subject: SubjectProperty
  ): Promise<void> {
    const toGeocode = candidates.filter(c => !c.lat || !c.lon);

    if (toGeocode.length === 0) {
      console.log(`   ✅ All candidates already have coordinates`);
      return;
    }

    console.log(`   🗺️  Geocoding ${toGeocode.length} candidates...`);

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

        // Geocode via Maps API (TODO: implement actual geocoding)
        // For now, skip actual geocoding
        console.log(`   ⚠️  Geocoding not implemented yet for: ${comp.address}`);

      } catch (error) {
        console.error(`❌ GEOCODE ERROR for "${comp.address}":`, error);
      }
    });

    await this.geocodeQueue.runMany(geocodeTasks, this.abortController.signal);
    console.log(`   ✅ Geocoding complete`);
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

    return candidates.filter(comp => {
      // Distance filter
      if (comp.distanceMi && comp.distanceMi > criteria.maxDistance) return false;

      // Bedroom filter
      if (subject.beds && comp.beds) {
        if (Math.abs(comp.beds - subject.beds) > criteria.bedsTolerance) return false;
      }

      // Bathroom filter
      if (subject.baths && comp.baths) {
        if (Math.abs(comp.baths - subject.baths) > criteria.bathsTolerance) return false;
      }

      // Sqft filter
      if (subject.sqft && comp.sqft) {
        const diff = Math.abs(comp.sqft - subject.sqft);
        const pct = diff / subject.sqft;
        if (pct > criteria.sqftTolerance) return false;
      }

      return true;
    });
  }

  /**
   * Get comps up to a specific level
   */
  private getCompsUpToLevel(seenComps: Map<string, ComparableProperty>, level: number): ComparableProperty[] {
    // Return all comps (filtering happens in applyPassFilters)
    return Array.from(seenComps.values());
  }
}
