// Progressive Expansion Search Strategy
// Replaces redundant identical searches with intelligent expansion

interface SearchLevel {
  level: number;
  name: string;
  criteria: {
    radius: number; // miles
    timeWindow: number; // months
    subdivision: boolean;
    sizeVariance: number; // percentage
    bedsVariance: number; // +/- beds
    bathsVariance: number; // +/- baths
    maxResults: number;
  };
  targetComps: number;
  description: string;
}

interface SearchResult {
  level: SearchLevel;
  properties: any[];
  qualified: any[];
  searchTime: number;
  success: boolean;
  cacheHit?: boolean;
}

interface ProgressiveSearchResult {
  finalProperties: any[];
  searchHistory: SearchResult[];
  stoppedAtLevel: number;
  summary: {
    totalSearches: number;
    totalTime: number;
    cacheHits: number;
    finalCount: number;
    qualityScore: 'excellent' | 'good' | 'fair' | 'poor';
  };
}

export class ProgressiveSearchStrategy {
  private cache = new Map<string, { result: any[]; timestamp: number }>();
  private readonly CACHE_TTL = 15 * 60 * 1000; // 15 minutes

  constructor() {
    // Cache enabled
  }

  /**
   * Define search levels with progressive expansion
   */
  private getSearchLevels(hasSubdivision: boolean): SearchLevel[] {
    const levels: SearchLevel[] = [
      {
        level: 1,
        name: 'Tight Local',
        criteria: {
          radius: 1.0,
          timeWindow: 12,
          subdivision: hasSubdivision,
          sizeVariance: 20,
          bedsVariance: 1,
          bathsVariance: 1,
          maxResults: 30
        },
        targetComps: 6,
        description: hasSubdivision ? 'Same subdivision, 1 mile, 12 months, ±1 beds/baths' : 'Local area, 1 mile, 12 months, ±1 beds/baths'
      },
      {
        level: 2,
        name: 'Extended Local',
        criteria: {
          radius: 2.0,
          timeWindow: 15,
          subdivision: hasSubdivision,
          sizeVariance: 20,
          bedsVariance: 1,
          bathsVariance: 1,
          maxResults: 40
        },
        targetComps: 4,
        description: hasSubdivision ? 'Same subdivision, 2 miles, 15 months, ±1 beds/baths' : 'Local area, 2 miles, 15 months, ±1 beds/baths'
      },
      {
        level: 3,
        name: 'Broader Market',
        criteria: {
          radius: 3.0,
          timeWindow: 18,
          subdivision: false,
          sizeVariance: 25,
          bedsVariance: 2,
          bathsVariance: 2,
          maxResults: 50
        },
        targetComps: 3,
        description: 'Market area, 3 miles, 18 months, ±2 beds/baths, no subdivision filter'
      },
      {
        level: 4,
        name: 'Extended Market',
        criteria: {
          radius: 5.0,
          timeWindow: 24,
          subdivision: false,
          sizeVariance: 30,
          bedsVariance: 3,
          bathsVariance: 3,
          maxResults: 75
        },
        targetComps: 2,
        description: 'Extended market, 5 miles, 24 months, ±3 beds/baths, relaxed criteria'
      }
    ];

    return levels;
  }

  /**
   * Generate cache key for search parameters
   */
  private generateCacheKey(
    address: string,
    level: SearchLevel,
    subjectDetails?: { sqft: number; beds: number; baths: number; yearBuilt: number }
  ): string {
    const key = [
      address.toLowerCase().trim(),
      level.level,
      level.criteria.radius,
      level.criteria.timeWindow,
      level.criteria.subdivision ? 'sub' : 'nosub',
      level.criteria.sizeVariance,
      subjectDetails ? `${subjectDetails.sqft}_${subjectDetails.beds}_${subjectDetails.baths}` : 'nosubject'
    ].join('|');

    return key;
  }

  /**
   * Check if we have a valid cached result
   */
  private getCachedResult(cacheKey: string): any[] | null {
    const cached = this.cache.get(cacheKey);
    if (!cached) return null;

    const isExpired = Date.now() - cached.timestamp > this.CACHE_TTL;
    if (isExpired) {
      this.cache.delete(cacheKey);
      return null;
    }

    return cached.result;
  }

  /**
   * Cache search result
   */
  private setCachedResult(cacheKey: string, result: any[]): void {
    this.cache.set(cacheKey, {
      result: [...result], // Deep copy
      timestamp: Date.now()
    });
  }

  /**
   * Check if we have enough comps for dual ARV analysis (baseline + upgrade)
   */
  private checkDualARVRequirements(
    properties: any[],
    subjectDetails: { baths: number } | undefined
  ): { sufficient: boolean; reason: string; baseline: number; upgrade: number } {
    if (!subjectDetails) {
      return { sufficient: true, reason: 'no subject details for bathroom analysis', baseline: 0, upgrade: 0 };
    }

    const subjectBaths = subjectDetails.baths;
    const epsilon = 1e-9; // Float comparison tolerance

    // Count baseline comps (≤ subject bathrooms)
    const baselineComps = properties.filter(prop => {
      const compBaths = parseFloat(prop.baths?.toString() || 'NaN');
      return Number.isFinite(compBaths) && compBaths <= subjectBaths + epsilon;
    });

    // Count upgrade comps (2+ bathrooms) - only relevant if subject has < 2 baths
    const upgradeComps = properties.filter(prop => {
      const compBaths = parseFloat(prop.baths?.toString() || 'NaN');
      return Number.isFinite(compBaths) && compBaths >= 2;
    });

    const needsUpgradeAnalysis = subjectBaths < 2;
    const hasEnoughBaseline = baselineComps.length >= 3;
    const hasEnoughUpgrade = upgradeComps.length >= 3;

    if (!needsUpgradeAnalysis) {
      // Subject has 2+ baths - only need baseline comps
      return {
        sufficient: hasEnoughBaseline,
        reason: hasEnoughBaseline ? 'sufficient baseline comps' : `need ${3 - baselineComps.length} more baseline comps (≤${subjectBaths} baths)`,
        baseline: baselineComps.length,
        upgrade: upgradeComps.length
      };
    } else {
      // Subject has < 2 baths - need both baseline AND upgrade comps for dual ARV
      const sufficient = hasEnoughBaseline && hasEnoughUpgrade;
      let reason = 'dual ARV requirements: ';

      if (!hasEnoughBaseline && !hasEnoughUpgrade) {
        reason += `need ${3 - baselineComps.length} more baseline (≤${subjectBaths} baths) and ${3 - upgradeComps.length} more upgrade (2+ baths) comps`;
      } else if (!hasEnoughBaseline) {
        reason += `need ${3 - baselineComps.length} more baseline comps (≤${subjectBaths} baths)`;
      } else if (!hasEnoughUpgrade) {
        reason += `need ${3 - upgradeComps.length} more upgrade comps (2+ baths)`;
      } else {
        reason = 'dual ARV requirements satisfied';
      }

      return {
        sufficient,
        reason,
        baseline: baselineComps.length,
        upgrade: upgradeComps.length
      };
    }
  }

  /**
   * Calculate quality score based on results
   */
  private calculateQualityScore(
    finalProperties: any[],
    searchHistory: SearchResult[]
  ): 'excellent' | 'good' | 'fair' | 'poor' {
    const count = finalProperties.length;
    const stoppedAtLevel = Math.max(...searchHistory.map(s => s.level.level));

    // Check distance quality
    const avgDistance = finalProperties.reduce((sum, p) => sum + (p.distance || 0), 0) / count;

    // Check time quality
    const recentComps = finalProperties.filter(p => {
      if (!p.soldDate) return false;
      const soldDate = new Date(p.soldDate);
      const monthsAgo = (Date.now() - soldDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
      return monthsAgo <= 12;
    }).length;

    if (count >= 6 && stoppedAtLevel <= 2 && avgDistance <= 1.5 && recentComps >= 4) {
      return 'excellent';
    } else if (count >= 4 && stoppedAtLevel <= 3 && avgDistance <= 2.5 && recentComps >= 2) {
      return 'good';
    } else if (count >= 3 && avgDistance <= 3.5) {
      return 'fair';
    } else {
      return 'poor';
    }
  }

  /**
   * Execute search at specific level
   */
  private async executeSearchLevel(
    level: SearchLevel,
    address: string,
    subjectDetails: { sqft: number; beds: number; baths: number; yearBuilt: number } | undefined,
    searchService: any, // VertexComparableSearchService
    propertyType?: string,
    accumulatedComps: any[] = [] // Comps from previous levels for distance filtering
  ): Promise<SearchResult> {
    const startTime = Date.now();
    const cacheKey = this.generateCacheKey(address, level, subjectDetails);

    console.log(`🔍 Level ${level.level}: ${level.name}`);
    console.log(`   📐 ${level.description}`);
    if (accumulatedComps.length > 0) {
      console.log(`   📊 Using ${accumulatedComps.length} accumulated comps from previous levels for distance filtering`);
    }

    // Check cache first
    const cachedResult = this.getCachedResult(cacheKey);
    if (cachedResult) {
      console.log(`   💾 Cache hit - returning ${cachedResult.length} cached properties`);
      return {
        level,
        properties: cachedResult,
        qualified: cachedResult, // Assume cached results are already qualified
        searchTime: Date.now() - startTime,
        success: true,
        cacheHit: true
      };
    }

    try {
      // Set search parameters
      const originalSubdivision = process.env.SUBDIVISION;
      if (level.criteria.subdivision && subjectDetails) {
        // We need subdivision info - this would come from property details
        // For now, keep existing subdivision setting
      } else {
        process.env.SUBDIVISION = '';
      }

      // Execute search
      console.log(`🔍 DEBUG LEVEL: About to call searchService.findComparables`);
      console.log(`🔍 DEBUG LEVEL: Parameters - address="${address}", propertyType="${propertyType}", maxResults=${level.criteria.maxResults}, radius=${level.criteria.radius}, timeWindow=${level.criteria.timeWindow}`);
      const searchResult = await searchService.findComparables(
        address,
        propertyType, // Pass through the propertyType parameter
        level.criteria.maxResults,
        level.criteria.radius,
        level.criteria.timeWindow,
        subjectDetails
      );
      console.log(`🔍 DEBUG LEVEL: searchService.findComparables completed`);
      console.log(`🔍 DEBUG LEVEL: searchResult type:`, typeof searchResult);
      console.log(`🔍 DEBUG LEVEL: searchResult keys:`, searchResult ? Object.keys(searchResult) : 'null');

      // 🚨 CRITICAL DEBUG CHECKPOINT: STATE DUMP FOR 1408 LYLE AVE BUG
      console.log('\n🔍 CRITICAL STATE DUMP - executeSearchLevel');
      console.log('===========================================');
      console.log(`🔍 Stage: POST_SEARCH_SERVICE_CALL`);
      console.log(`🔍 Level: ${level.level} (${level.name})`);
      console.log(`🔍 SearchResult structure:`, JSON.stringify(searchResult, null, 2));

      if (searchResult && searchResult.comparables) {
        console.log(`🔍 SearchResult.comparables length: ${searchResult.comparables.length}`);
        searchResult.comparables.forEach((comp, index) => {
          console.log(`🔍   [${index}] ${comp.address || 'NO_ADDRESS'} - $${comp.price || 'NO_PRICE'} - ${comp.sqft || 'NO_SQFT'}sqft`);
          if (comp.address && comp.address.toLowerCase().includes('lyle')) {
            console.log(`🚨 1408 LYLE AVE FOUND IN SEARCHRESULT.COMPARABLES at index ${index}`);
          }
        });
      } else {
        console.log(`🚨 SearchResult.comparables is NULL or UNDEFINED`);
        console.log(`🚨 searchResult:`, searchResult);
      }

      // Restore original subdivision
      process.env.SUBDIVISION = originalSubdivision;

      const searchTime = Date.now() - startTime;
      const qualified = searchResult.comparables || [];

      console.log(`\n🔍 CRITICAL STATE DUMP - POST_EXTRACTION`);
      console.log('========================================');
      console.log(`🔍 Stage: POST_QUALIFIED_EXTRACTION`);
      console.log(`🔍 qualified.length: ${qualified.length}`);
      console.log(`🔍 qualified array:`, qualified.map(comp => `${comp.address} - $${comp.price}`));

      if (qualified.length === 0) {
        console.log(`🚨 CRITICAL: qualified array is EMPTY despite potential searchResult.comparables`);
        console.log(`🚨 This is the exact bug we're tracking!`);
      }

      qualified.forEach((comp, index) => {
        if (comp.address && comp.address.toLowerCase().includes('lyle')) {
          console.log(`🚨 1408 LYLE AVE FOUND IN QUALIFIED ARRAY at index ${index}`);
        }
      });

      console.log(`   ✅ Found ${qualified.length} qualified comps in ${searchTime}ms`);

      // Cache the result
      this.setCachedResult(cacheKey, qualified);

      return {
        level,
        properties: qualified,
        qualified,
        searchTime,
        success: true,
        cacheHit: false
      };

    } catch (error) {
      console.log(`   ❌ Level ${level.level} failed: ${error.message}`);

      return {
        level,
        properties: [],
        qualified: [],
        searchTime: Date.now() - startTime,
        success: false,
        cacheHit: false
      };
    }
  }

  /**
   * Execute progressive search with early termination
   */
  async executeProgressiveSearch(
    address: string,
    subjectDetails: { sqft: number; beds: number; baths: number; yearBuilt: number; subdivision?: string } | undefined,
    searchService: any,
    subdivision?: string,
    propertyType?: string
  ): Promise<ProgressiveSearchResult> {
    console.log('🎯 PROGRESSIVE EXPANSION SEARCH');
    console.log('===============================');
    console.log(`📍 Subject: ${address}`);
    console.log(`🚨 DEBUG PROGRESSIVE SEARCH: propertyType="${propertyType}" (type: ${typeof propertyType})`);
    if (subjectDetails) {
      console.log(`🏠 Subject: ${subjectDetails.sqft}sqft, ${subjectDetails.beds}BR/${subjectDetails.baths}BA, built ${subjectDetails.yearBuilt}`);
    }

    const hasSubdivision = Boolean(subdivision || process.env.SUBDIVISION);
    const searchLevels = this.getSearchLevels(hasSubdivision);
    const searchHistory: SearchResult[] = [];
    const allProperties = new Map<string, any>(); // Use Map to avoid duplicates
    const allDiscoveredComps = new Map<string, any>(); // Track ALL discovered comps for re-evaluation
    let accumulatedComps: any[] = []; // Track comps for cumulative use in distance filtering

    let stoppedAtLevel = 0;
    const startTime = Date.now();

    for (const level of searchLevels) {
      const result = await this.executeSearchLevel(level, address, subjectDetails, searchService, propertyType, []);
      searchHistory.push(result);
      stoppedAtLevel = level.level;

      if (result.success && result.qualified.length > 0) {
        // First, add ALL new discoveries to our accumulation (without distance filtering)
        result.qualified.forEach(prop => {
          const key = `${prop.address}|${prop.price}|${prop.sqft}`;
          if (!allDiscoveredComps.has(key)) {
            allDiscoveredComps.set(key, { ...prop, foundAtLevel: level.level });
          }
        });

        // Now re-evaluate ALL accumulated properties with current level's radius
        const allAccumulatedProps = Array.from(allDiscoveredComps.values());
        console.log(`   📐 Re-evaluating ALL ${allAccumulatedProps.length} accumulated comps with Level ${level.level} radius (${level.criteria.radius}mi)`);
        const levelValidatedComps = await this.applyDistanceFilteringToLevel(allAccumulatedProps, address, level);
        console.log(`   📐 After re-evaluation: ${levelValidatedComps.length} valid comps at ${level.criteria.radius}mi radius`);

        // Update allProperties with ALL comps that pass current level's distance filter
        allProperties.clear(); // Clear previous to rebuild with current radius
        levelValidatedComps.forEach(prop => {
          const key = `${prop.address}|${prop.price}|${prop.sqft}`;
          allProperties.set(key, prop);
        });

        const totalValidated = allProperties.size;
        console.log(`   📊 Total distance-validated comps so far: ${totalValidated}`);

        // Simple termination criteria: just check if we have enough distance-validated comps
        if (totalValidated >= level.targetComps) {
          console.log(`   🎯 Progressive search target achieved: ${totalValidated} distance-validated comps found (≥ ${level.targetComps} required) - stopping search`);
          break;
        } else {
          console.log(`   ⏭️  Need ${level.targetComps - totalValidated} more distance-validated comps - continuing to next level`);
        }
      } else {
        console.log(`   ⚠️  Level ${level.level} produced no results - continuing`);
      }
    }

    // Distance filtering already applied during each level, just get final results
    const finalProperties = Array.from(allProperties.values());

    const totalTime = Date.now() - startTime;
    const cacheHits = searchHistory.filter(s => s.cacheHit).length;
    const qualityScore = this.calculateQualityScore(finalProperties, searchHistory);

    console.log('\n📊 PROGRESSIVE SEARCH SUMMARY:');
    console.log(`   🔍 Searches executed: ${searchHistory.length}`);
    console.log(`   💾 Cache hits: ${cacheHits}/${searchHistory.length}`);
    console.log(`   ⏱️  Total time: ${totalTime}ms`);
    console.log(`   🏁 Stopped at level: ${stoppedAtLevel}`);
    console.log(`   📈 Final count: ${finalProperties.length} properties`);
    console.log(`   🎯 Quality score: ${qualityScore.toUpperCase()}`);

    // Log level breakdown
    console.log('\n📋 LEVEL BREAKDOWN:');
    searchHistory.forEach(result => {
      const icon = result.success ? '✅' : '❌';
      const cache = result.cacheHit ? '💾' : '🔍';
      console.log(`   ${icon} ${cache} Level ${result.level.level}: ${result.qualified.length} comps (${result.searchTime}ms)`);
    });

    return {
      finalProperties,
      searchHistory,
      stoppedAtLevel,
      summary: {
        totalSearches: searchHistory.length,
        totalTime,
        cacheHits,
        finalCount: finalProperties.length,
        qualityScore
      }
    };
  }

  /**
   * Clear cache (useful for testing)
   */
  clearCache(): void {
    this.cache.clear();
    console.log('🗑️  Progressive search cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { entries: number; oldestEntry: number; totalSize: number } {
    const now = Date.now();
    let oldestEntry = now;
    let totalSize = 0;

    for (const [key, entry] of this.cache) {
      if (entry.timestamp < oldestEntry) {
        oldestEntry = entry.timestamp;
      }
      totalSize += entry.result.length;
    }

    return {
      entries: this.cache.size,
      oldestEntry: now - oldestEntry,
      totalSize
    };
  }

  /**
   * Apply distance filtering to a single level's results
   */
  private async applyDistanceFilteringToLevel(
    properties: any[],
    subjectAddress: string,
    level: SearchLevel
  ): Promise<any[]> {
    if (properties.length === 0) return properties;

    console.log(`\n📐 DISTANCE VALIDATION (Level ${level.level}): Checking ${properties.length} properties`);

    // Import GoogleMapsGeocoder to get subject coordinates
    const { GoogleMapsGeocoder } = await import('./googleMapsGeocoder');
    const geocoder = new GoogleMapsGeocoder();

    const subjectResult = await geocoder.geocodeAddress(subjectAddress);
    if (!subjectResult) {
      console.log(`❌ Cannot get subject coordinates for ${subjectAddress} - skipping distance filtering`);
      return properties;
    }

    const subjectLat = subjectResult.lat;
    const subjectLng = subjectResult.lng;
    const maxRadius = level.criteria.radius;
    console.log(`📍 Subject coordinates: ${subjectLat}, ${subjectLng} (max radius: ${maxRadius}mi)`);

    const filteredProperties: any[] = [];

    for (const property of properties) {
      // Get property coordinates
      const propResult = await geocoder.geocodeAddress(property.address);
      if (!propResult) {
        console.log(`   ❌ Cannot geocode ${property.address} - excluding`);
        continue;
      }

      // Calculate distance
      const distance = this.calculateHaversineDistance(
        subjectLat, subjectLng, propResult.lat, propResult.lng
      );

      property.distance = distance; // Add distance to property for logging

      if (distance <= maxRadius) {
        console.log(`   ✅ ${property.address}: ${distance.toFixed(2)} miles (≤ ${maxRadius}mi)`);
        filteredProperties.push(property);
      } else {
        console.log(`   ❌ ${property.address}: ${distance.toFixed(2)} miles (> ${maxRadius}mi) - EXCLUDED`);
      }
    }

    console.log(`📐 Level ${level.level} distance filtering: ${properties.length} → ${filteredProperties.length} properties`);
    return filteredProperties;
  }

  /**
   * Apply distance filtering to final results based on which level they were found at
   */
  private async applyDistanceFiltering(
    properties: any[],
    subjectAddress: string,
    searchLevels: SearchLevel[]
  ): Promise<any[]> {
    if (properties.length === 0) return properties;

    console.log(`\n📐 DISTANCE VALIDATION: Checking ${properties.length} properties`);

    // Import GoogleMapsGeocoder to get subject coordinates
    const { GoogleMapsGeocoder } = await import('./googleMapsGeocoder');
    const geocoder = new GoogleMapsGeocoder();

    const subjectResult = await geocoder.geocodeAddress(subjectAddress);
    if (!subjectResult) {
      console.log(`❌ Cannot get subject coordinates for ${subjectAddress} - skipping distance filtering`);
      return properties;
    }

    const subjectLat = subjectResult.lat;
    const subjectLng = subjectResult.lng;
    console.log(`📍 Subject coordinates: ${subjectLat}, ${subjectLng}`);

    const filteredProperties: any[] = [];

    for (const property of properties) {
      // Get the level this property was found at
      const foundAtLevel = property.foundAtLevel || 1;
      const levelConfig = searchLevels.find(l => l.level === foundAtLevel);
      const maxRadius = levelConfig?.criteria.radius || 5.0; // Default fallback

      // Get property coordinates
      const propResult = await geocoder.geocodeAddress(property.address);
      if (!propResult) {
        console.log(`   ❌ Cannot geocode ${property.address} - excluding`);
        continue;
      }

      // Calculate distance
      const distance = this.calculateHaversineDistance(
        subjectLat, subjectLng, propResult.lat, propResult.lng
      );

      property.distance = distance; // Add distance to property for logging

      if (distance <= maxRadius) {
        console.log(`   ✅ ${property.address}: ${distance.toFixed(2)} miles (≤ ${maxRadius}mi for Level ${foundAtLevel})`);
        filteredProperties.push(property);
      } else {
        console.log(`   ❌ ${property.address}: ${distance.toFixed(2)} miles (> ${maxRadius}mi for Level ${foundAtLevel}) - EXCLUDED`);
      }
    }

    console.log(`📐 Distance filtering: ${properties.length} → ${filteredProperties.length} properties`);
    return filteredProperties;
  }

  /**
   * Calculate distance between two coordinates using Haversine formula
   */
  private calculateHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 3959; // Earth's radius in miles
    const dLat = this.degreesToRadians(lat2 - lat1);
    const dLon = this.degreesToRadians(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.degreesToRadians(lat1)) * Math.cos(this.degreesToRadians(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    return distance;
  }

  /**
   * Helper function to convert degrees to radians
   */
  private degreesToRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }
}