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
          sizeVariance: 15,
          maxResults: 30
        },
        targetComps: 6,
        description: hasSubdivision ? 'Same subdivision, 1 mile, 12 months' : 'Local area, 1 mile, 12 months'
      },
      {
        level: 2,
        name: 'Extended Local',
        criteria: {
          radius: 2.0,
          timeWindow: 15,
          subdivision: hasSubdivision,
          sizeVariance: 20,
          maxResults: 40
        },
        targetComps: 4,
        description: hasSubdivision ? 'Same subdivision, 2 miles, 15 months' : 'Local area, 2 miles, 15 months'
      },
      {
        level: 3,
        name: 'Broader Market',
        criteria: {
          radius: 3.0,
          timeWindow: 18,
          subdivision: false, // Remove subdivision filter
          sizeVariance: 20,
          maxResults: 50
        },
        targetComps: 3,
        description: 'Market area, 3 miles, 18 months, no subdivision filter'
      },
      {
        level: 4,
        name: 'Extended Market',
        criteria: {
          radius: 4.0,
          timeWindow: 24,
          subdivision: false,
          sizeVariance: 25,
          maxResults: 75
        },
        targetComps: 2,
        description: 'Extended market, 4 miles, 24 months, relaxed size criteria'
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
    searchService: any // VertexComparableSearchService
  ): Promise<SearchResult> {
    const startTime = Date.now();
    const cacheKey = this.generateCacheKey(address, level, subjectDetails);


    // Check cache first
    const cachedResult = this.getCachedResult(cacheKey);
    if (cachedResult) {
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
      const searchResult = await searchService.findComparables(
        address,
        undefined, // propertyType
        level.criteria.maxResults,
        level.criteria.radius,
        level.criteria.timeWindow,
        subjectDetails
      );

      // Restore original subdivision
      process.env.SUBDIVISION = originalSubdivision;

      const searchTime = Date.now() - startTime;
      const qualified = searchResult.comparables || [];


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
    subdivision?: string
  ): Promise<ProgressiveSearchResult> {
    if (subjectDetails) {
    }

    const hasSubdivision = Boolean(subdivision || process.env.SUBDIVISION);
    const searchLevels = this.getSearchLevels(hasSubdivision);
    const searchHistory: SearchResult[] = [];
    const allProperties = new Map<string, any>(); // Use Map to avoid duplicates

    let stoppedAtLevel = 0;
    const startTime = Date.now();

    for (const level of searchLevels) {
      const result = await this.executeSearchLevel(level, address, subjectDetails, searchService);
      searchHistory.push(result);
      stoppedAtLevel = level.level;

      if (result.success && result.qualified.length > 0) {
        // Add properties to collection (Map handles duplicates by address)
        result.qualified.forEach(prop => {
          const key = `${prop.address}|${prop.price}|${prop.sqft}`;
          if (!allProperties.has(key)) {
            allProperties.set(key, { ...prop, foundAtLevel: level.level });
          }
        });

        const totalQualified = allProperties.size;

        // Check if we have enough comps to stop (including bathroom-specific requirements)
        const hasEnoughForDualARV = this.checkDualARVRequirements(Array.from(allProperties.values()), subjectDetails);

        if (totalQualified >= level.targetComps && hasEnoughForDualARV.sufficient) {
          break;
        } else {
          const reason = hasEnoughForDualARV.sufficient ?
            `need ${level.targetComps - totalQualified} more general comps` :
            hasEnoughForDualARV.reason;
        }
      } else {
      }
    }

    const finalProperties = Array.from(allProperties.values());
    const totalTime = Date.now() - startTime;
    const cacheHits = searchHistory.filter(s => s.cacheHit).length;
    const qualityScore = this.calculateQualityScore(finalProperties, searchHistory);


    // Log level breakdown
    searchHistory.forEach(result => {
      const icon = result.success ? '✅' : '❌';
      const cache = result.cacheHit ? '💾' : '🔍';
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
}