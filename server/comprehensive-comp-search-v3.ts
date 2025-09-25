// Comprehensive Comparable Search V3 - V2 with Dual ARV Analysis
// Same as V2 but with dual ARV calculation: baseline + 2-bathroom upgrade scenarios

import { VertexComparableSearchService } from './step3-find-comparables.js';
import { ARVCalculationService } from './step4-arv-calculation.js';
import { fetchPropertyDetailsViaVertex } from './vertex-details.js';
import { PropertyDataNormalizer } from './utils/propertyDataNormalizer.js';
import { SmartDeduplicator } from './utils/smartDeduplicator.js';
import { ProgressiveSearchStrategy } from './utils/progressiveSearchStrategy.js';
import { DistanceValidator } from './utils/distanceValidator.js';

interface ComprehensiveSearchResultV3 {
  all_comps: any[];
  qualified_comps: any[];
  consistency_scores: Map<string, number>;
  renovation_analysis: {
    likely_renovated: any[];
    likely_unrenovated: any[];
    market_average: any[];
  };
  // DUAL ARV - Key difference from V2
  arv?: {
    method: string;
    estimate: number;
    confidence: 'high' | 'medium' | 'low';
    dataPoints: number;
  };
  twoBathARV?: {
    method: string;
    estimate: number;
    confidence: 'high' | 'medium' | 'low';
    dataPoints: number;
    valueAdd: number;
    valueAddPercent: number;
    roiEstimate?: number;
  };
  bathroomAnalysis: {
    subjectBaths: number;
    recommendAction: 'hold' | 'renovate' | 'sell_as_is';
    baselineCompsUsed: number;
    upgradeCompsUsed?: number;
  };
  searchMetadata: {
    version: string;
    strategy: 'progressive_expansion';
    searchLevels: number;
    totalSearchTime: number;
    qualityScore: 'excellent' | 'good' | 'fair' | 'poor';
    cacheHits: number;
    normalizationSummary: any;
    deduplicationSummary: any;
    distanceValidationSummary: any;
  };
}

export class ComprehensiveCompSearchV3 {
  private compService: VertexComparableSearchService;
  private arvService: ARVCalculationService;
  private normalizer: PropertyDataNormalizer;
  private deduplicator: SmartDeduplicator;
  private progressiveSearch: ProgressiveSearchStrategy;
  private distanceValidator: DistanceValidator;

  constructor() {
    this.compService = new VertexComparableSearchService();
    this.arvService = new ARVCalculationService();
    this.normalizer = new PropertyDataNormalizer();
    this.deduplicator = new SmartDeduplicator();
    this.progressiveSearch = new ProgressiveSearchStrategy();
    this.distanceValidator = new DistanceValidator();
  }

  async findComparables(address: string): Promise<ComprehensiveSearchResultV3> {
    const startTime = Date.now();
    console.log(`\n🔍 COMPREHENSIVE COMPARABLE SEARCH V3`);
    console.log(`============================================================`);
    console.log(`📍 Analyzing: ${address}`);

    try {
      // Step 1: Get subject property details
      console.log(`\n📋 Step 1: Subject Property Research`);
      const subjectDetails = await fetchPropertyDetailsViaVertex(address);

      if (!subjectDetails) {
        throw new Error('Could not fetch subject property details');
      }

      console.log(`   ✅ Subject: ${subjectDetails.beds}BR/${subjectDetails.baths}BA, ${subjectDetails.sqft}sqft, Built ${subjectDetails.yearBuilt}`);
      if (subjectDetails.subdivision) {
        console.log(`   🏘️  Subdivision: ${subjectDetails.subdivision}`);
      }

      // Step 2: Progressive comparable search
      console.log(`\n🔍 Step 2: Progressive Comparable Search`);

      let allComps: any[] = [];
      let searchLevel = 0;
      const maxSearchLevels = 3;

      // Use progressive search strategy with subject details
      if (subjectDetails.beds && subjectDetails.baths && subjectDetails.sqft && subjectDetails.yearBuilt) {
        console.log(`   📐 Using subject details for targeted search`);
        // Set subdivision in environment for progressive search
        if (subjectDetails.subdivision) {
          process.env.SUBDIVISION = subjectDetails.subdivision;
          console.log(`   🏘️  Using subdivision: ${subjectDetails.subdivision}`);
        }

        const progressiveResult = await this.progressiveSearch.executeProgressiveSearch(
          address,
          subjectDetails,
          this.compService,
          subjectDetails.subdivision
        );
        allComps = progressiveResult.finalProperties;
      } else {
        console.log(`   ⚠️  Subject details incomplete; using progressive search without strict filters.`);
        // Fallback to basic progressive search
        for (searchLevel = 0; searchLevel < maxSearchLevels; searchLevel++) {
          const radius = 1.5 + (searchLevel * 0.5); // 1.5, 2.0, 2.5 miles
          const timeWindow = 12 + (searchLevel * 6); // 12, 18, 24 months
          const maxResults = 15 + (searchLevel * 5); // 15, 20, 25 results

          console.log(`   🎯 Search Level ${searchLevel + 1}: ${radius}mi radius, ${timeWindow}mo window, max ${maxResults} results`);

          const result = await this.compService.findComparables(
            address,
            undefined, // propertyType
            maxResults,
            radius,
            timeWindow,
            subjectDetails
          );

          if (result.success && result.comparables.length > 0) {
            allComps.push(...result.comparables);
            console.log(`      ➕ Found ${result.comparables.length} comps at level ${searchLevel + 1}`);
          }

          // Stop if we have enough comparables
          if (allComps.length >= 10) {
            console.log(`      ✅ Sufficient comparables found (${allComps.length}), stopping search`);
            break;
          }
        }
      }

      console.log(`   📊 Total raw comparables found: ${allComps.length}`);

      if (allComps.length === 0) {
        throw new Error('No comparables found in progressive search');
      }

      // Step 3: Data normalization
      console.log(`\n🔧 Step 3: Data Normalization`);
      const normalizationResult = this.normalizer.processProperties(allComps);
      const normalizedComps = normalizationResult.normalized;
      const normalizationSummary = normalizationResult.summary;
      console.log(`   ✅ Normalized: ${normalizedComps.length}/${allComps.length} properties improved`);

      // Step 4: Smart deduplication
      console.log(`\n🔄 Step 4: Smart Deduplication`);
      const deduplicationResult = this.deduplicator.deduplicateProperties(normalizedComps);
      const deduplicatedComps = deduplicationResult.deduplicated;
      const deduplicationSummary = deduplicationResult.summary;
      console.log(`   ✅ Deduplicated: ${deduplicatedComps.length} unique (removed ${deduplicationSummary.duplicatesRemoved} duplicates)`);

      // Step 5: Distance validation
      console.log(`\n📏 Step 5: Distance Validation`);
      const distanceResult = await this.distanceValidator.validateComparableDistances(
        address,
        deduplicatedComps,
        2.5 // max miles
      );
      const distanceValidatedComps = distanceResult.validated;
      const distanceValidationSummary = distanceResult.validationSummary;
      console.log(`   ✅ Distance validated: ${distanceValidatedComps.length} within range`);

      // Step 6: Quality filtering and consistency scoring
      console.log(`\n⭐ Step 6: Quality Assessment`);
      const consistencyScores = this.calculateConsistencyScores(distanceValidatedComps);
      const qualifiedComps = distanceValidatedComps.filter((_, index) =>
        consistencyScores.get(index.toString()) && consistencyScores.get(index.toString())! > 0.6
      );
      console.log(`   ✅ Quality filtered: ${qualifiedComps.length}/${distanceValidatedComps.length} high-quality comps`);

      // Step 7: Renovation analysis
      console.log(`\n🔨 Step 7: Renovation Analysis`);
      const renovationAnalysis = this.analyzeRenovationLevels(qualifiedComps);

      // Step 8: Bathroom Analysis and Dual ARV Calculation
      console.log(`\n🚿 Step 8: Bathroom Analysis & Dual ARV Calculation`);
      const subjectBaths = this.computeSubjectBathrooms(subjectDetails);
      console.log(`   🏠 Subject Bathrooms: ${subjectBaths}`);

      // BASELINE ARV (same as V2)
      let arvResult = undefined;
      let twoBathARV = undefined;
      let bathroomAnalysis: {
        subjectBaths: number;
        recommendAction: 'hold' | 'renovate' | 'sell_as_is';
        baselineCompsUsed: number;
        upgradeCompsUsed?: number;
      } = {
        subjectBaths,
        recommendAction: 'sell_as_is',
        baselineCompsUsed: 0
      };

      if (qualifiedComps.length >= 3 && subjectDetails.sqft) {
        // Baseline ARV calculation
        const baselineComps = this.filterComparablesForBaseline(qualifiedComps, subjectBaths);
        console.log(`   📊 Baseline comps (≤${subjectBaths} baths): ${baselineComps.length}`);

        if (baselineComps.length >= 3) {
          const baselineARV = this.arvService.calculateARV(baselineComps, subjectDetails.sqft);
          arvResult = {
            method: 'comprehensive_v3_baseline',
            estimate: baselineARV.arv,
            confidence: baselineARV.confidence,
            dataPoints: baselineComps.length
          };
          bathroomAnalysis.baselineCompsUsed = baselineComps.length;
          console.log(`   ✅ Baseline ARV: $${arvResult.estimate.toLocaleString()} (${arvResult.confidence} confidence, ${arvResult.dataPoints} comps)`);
        }

        // TWO-BATHROOM ARV (only if subject has < 2 baths AND we have sufficient baseline comps)
        if (subjectBaths < 2 && arvResult) {
          console.log(`   🛁 Calculating 2-bathroom upgrade scenario...`);
          const twoBathComps = this.filterComparablesForTwoBath(qualifiedComps, subjectDetails);
          console.log(`   📊 Upgrade comps (2+ baths): ${twoBathComps.length}`);

          if (twoBathComps.length >= 3 && baselineComps.length >= 3) {
            const upgradeARV = this.arvService.calculateARV(twoBathComps, subjectDetails.sqft);
            const baselineEstimate = arvResult ? arvResult.estimate : upgradeARV.arv * 0.85; // Fallback if no baseline
            const valueAdd = upgradeARV.arv - baselineEstimate;
            const valueAddPercent = (valueAdd / baselineEstimate) * 100;

            // ROI Calculation
            const estimatedRenovationCost = 12000;
            const netGain = valueAdd - estimatedRenovationCost;
            const roi = (netGain / estimatedRenovationCost) * 100;

            twoBathARV = {
              method: 'comprehensive_v3_upgrade',
              estimate: upgradeARV.arv,
              confidence: upgradeARV.confidence,
              dataPoints: twoBathComps.length,
              valueAdd,
              valueAddPercent,
              roiEstimate: roi
            };

            bathroomAnalysis.upgradeCompsUsed = twoBathComps.length;
            bathroomAnalysis.recommendAction = this.generateRecommendation(
              arvResult.estimate,
              upgradeARV.arv,
              arvResult.confidence
            );

            console.log(`   ✅ 2-Bath ARV: $${twoBathARV.estimate.toLocaleString()} (${twoBathARV.confidence} confidence, ${twoBathARV.dataPoints} comps)`);
            console.log(`   💰 Value Add: $${valueAdd.toLocaleString()} (${valueAddPercent.toFixed(1)}%)`);
            console.log(`   📈 ROI Estimate: ${roi.toFixed(1)}%`);
          } else {
            console.log(`   ⚠️  Insufficient comps for dual ARV analysis:`);
            console.log(`       • Baseline comps (≤${subjectBaths} baths): ${baselineComps.length}/3 needed`);
            console.log(`       • Upgrade comps (2+ baths): ${twoBathComps.length}/3 needed`);
          }
        } else {
          console.log(`   ℹ️  Subject has ${subjectBaths} bathrooms - no upgrade scenario needed`);
        }
      } else {
        console.log(`   ⚠️  Insufficient data for reliable ARV calculation (need ≥3 comps, have ${qualifiedComps.length})`);
      }

      console.log(`   🎯 Recommendation: ${bathroomAnalysis.recommendAction.toUpperCase().replace('_', ' ')}`);

      // Calculate quality score
      const qualityScore = this.assessOverallQuality(qualifiedComps.length, consistencyScores);
      const totalSearchTime = Date.now() - startTime;

      console.log(`\n📊 COMPREHENSIVE SEARCH V3 COMPLETE`);
      console.log(`   Quality Score: ${qualityScore}`);
      console.log(`   Total Time: ${totalSearchTime}ms`);
      console.log(`   Final Comps: ${qualifiedComps.length}`);
      console.log(`============================================================\n`);

      return {
        all_comps: allComps,
        qualified_comps: qualifiedComps,
        consistency_scores: consistencyScores,
        renovation_analysis: renovationAnalysis,
        arv: arvResult,
        twoBathARV,
        bathroomAnalysis,
        searchMetadata: {
          version: 'v3.0',
          strategy: 'progressive_expansion',
          searchLevels: searchLevel + 1,
          totalSearchTime,
          qualityScore,
          cacheHits: 0, // Could be implemented
          normalizationSummary,
          deduplicationSummary,
          distanceValidationSummary
        }
      };

    } catch (error: any) {
      console.error(`   ❌ Comprehensive search failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Enhanced bathroom computation from run-analysis.ts
   */
  private computeSubjectBathrooms(subjectDetails: any): number {
    // Direct baths field from subjectDetails (already parsed)
    const directBaths = Number(subjectDetails.baths);
    if (Number.isFinite(directBaths) && directBaths > 0) {
      return directBaths;
    }

    // Fallback: try description if available
    if (subjectDetails?.description) {
      const desc = subjectDetails.description;
      const descBaths = Number(desc.baths);
      if (Number.isFinite(descBaths) && descBaths > 0) {
        return descBaths;
      }

      // Calculated approach (full + half baths)
      const fullCalc = Number(desc.baths_full_calc) || 0;
      const halfCalc = Number(desc.baths_partial_calc) || 0;
      const full = Number(desc.baths_full) || 0;
      const half = Number(desc.baths_half) || 0;

      let total = 0;
      total += (fullCalc || full);
      total += 0.5 * (halfCalc || half);

      if (total > 0) return total;
    }

    return 1; // Default fallback
  }

  /**
   * BASELINE filtering - Conservative estimate using similar/lower bathroom counts
   */
  private filterComparablesForBaseline(comps: any[], subjectBaths: number): any[] {
    const epsilon = 1e-9; // Float comparison tolerance

    return comps.filter(comp => {
      const compBaths = parseFloat(comp.baths?.toString() || 'NaN');

      // Must have valid bathroom count
      if (!Number.isFinite(compBaths)) return false;

      // Only use comps with baths <= subject (conservative approach)
      if (compBaths > subjectBaths + epsilon) return false;

      // Additional quality filters
      if (!Number.isFinite(comp.price) || !Number.isFinite(comp.sqft)) return false;
      if (comp.price <= 0 || comp.sqft <= 0) return false;

      return true;
    });
  }

  /**
   * TWO-BATHROOM filtering - Upgrade scenario using 2+ bathroom comps
   */
  private filterComparablesForTwoBath(comps: any[], subjectDetails: any): any[] {
    return comps.filter(comp => {
      const compBaths = parseFloat(comp.baths?.toString() || 'NaN');

      // Must have 2-3 bathrooms for upgrade scenario
      if (!Number.isFinite(compBaths) || compBaths < 2 || compBaths > 3) return false;

      // Still apply other quality filters
      if (!Number.isFinite(comp.price) || !Number.isFinite(comp.sqft)) return false;

      // Size compatibility (±20% from subject)
      if (subjectDetails.sqft) {
        const sizeVariance = Math.abs(comp.sqft - subjectDetails.sqft) / subjectDetails.sqft;
        if (sizeVariance > 0.20) return false;
      }

      return true;
    });
  }

  /**
   * Generate renovation recommendation based on analysis
   */
  private generateRecommendation(
    baselineARV: number,
    twoBathARV?: number,
    confidence?: 'high' | 'medium' | 'low'
  ): 'hold' | 'renovate' | 'sell_as_is' {

    if (!twoBathARV) return 'sell_as_is'; // No upgrade scenario available

    const valueAdd = twoBathARV - baselineARV;
    const estimatedRenovationCost = 12000; // Typical bathroom addition cost
    const netGain = valueAdd - estimatedRenovationCost;
    const roi = (netGain / estimatedRenovationCost) * 100;

    // Decision logic
    if (confidence === 'high' && roi > 25) return 'renovate';
    if (confidence === 'medium' && roi > 40) return 'renovate';
    if (confidence === 'low' && roi > 60) return 'renovate';

    if (baselineARV > 200000) return 'hold'; // Good value, hold for appreciation
    return 'sell_as_is';
  }

  private calculateConsistencyScores(properties: any[]): Map<string, number> {
    const scores = new Map<string, number>();

    properties.forEach((prop, index) => {
      let score = 1.0; // Start with perfect score

      // Penalize missing critical data
      if (!prop.price || prop.price <= 0) score -= 0.3;
      if (!prop.sqft || prop.sqft <= 0) score -= 0.3;
      if (!prop.beds || prop.beds <= 0) score -= 0.2;
      if (!prop.baths || prop.baths <= 0) score -= 0.1;
      if (!prop.soldDate) score -= 0.1;

      scores.set(index.toString(), Math.max(0, score));
    });

    return scores;
  }

  private analyzeRenovationLevels(properties: any[]): {
    likely_renovated: any[];
    likely_unrenovated: any[];
    market_average: any[];
  } {
    const ppsf = properties
      .map(p => p.price / p.sqft)
      .filter(p => !isNaN(p) && p > 0);

    if (ppsf.length === 0) {
      return {
        likely_renovated: [],
        likely_unrenovated: [],
        market_average: properties
      };
    }

    // Calculate median PPSF
    const sortedPpsf = ppsf.sort((a, b) => a - b);
    const medianPpsf = sortedPpsf[Math.floor(sortedPpsf.length / 2)];
    const threshold = medianPpsf * 1.075; // 7.5% above median

    const likely_renovated = properties.filter(p => {
      const propPpsf = p.price / p.sqft;
      return propPpsf >= threshold;
    });

    const likely_unrenovated = properties.filter(p => {
      const propPpsf = p.price / p.sqft;
      return propPpsf < threshold * 0.9; // Below 90% of threshold
    });

    const market_average = properties.filter(p => {
      const propPpsf = p.price / p.sqft;
      return propPpsf >= threshold * 0.9 && propPpsf < threshold;
    });

    console.log(`   🔧 Renovation analysis:`);
    console.log(`      Likely renovated: ${likely_renovated.length} (≥$${threshold.toFixed(2)}/sqft)`);
    console.log(`      Market average: ${market_average.length}`);
    console.log(`      Likely unrenovated: ${likely_unrenovated.length}`);

    return {
      likely_renovated,
      likely_unrenovated,
      market_average
    };
  }

  private assessOverallQuality(compCount: number, consistencyScores: Map<string, number>): 'excellent' | 'good' | 'fair' | 'poor' {
    const avgConsistency = Array.from(consistencyScores.values()).reduce((a, b) => a + b, 0) / consistencyScores.size;

    if (compCount >= 8 && avgConsistency >= 0.8) return 'excellent';
    if (compCount >= 5 && avgConsistency >= 0.7) return 'good';
    if (compCount >= 3 && avgConsistency >= 0.6) return 'fair';
    return 'poor';
  }
}

// Test function
async function testComprehensiveSearchV3() {
  const address = process.env.ADDRESS;
  if (!address) {
    console.error('❌ ADDRESS environment variable is required');
    process.exit(1);
  }

  try {
    const service = new ComprehensiveCompSearchV3();
    const result = await service.findComparables(address);

    console.log(`✅ Search completed successfully!`);
    console.log(`   All Comps: ${result.all_comps.length}`);
    console.log(`   Qualified: ${result.qualified_comps.length}`);
    console.log(`   Renovated: ${result.renovation_analysis.likely_renovated.length}`);
    console.log(`   Quality: ${result.searchMetadata.qualityScore}`);
    console.log(`   Subject Baths: ${result.bathroomAnalysis.subjectBaths}`);
    console.log(`   Recommendation: ${result.bathroomAnalysis.recommendAction}`);

    if (result.arv) {
      console.log(`   Baseline ARV: $${result.arv.estimate.toLocaleString()}`);
    }

    if (result.twoBathARV) {
      console.log(`   2-Bath ARV: $${result.twoBathARV.estimate.toLocaleString()}`);
      console.log(`   Value Add: $${result.twoBathARV.valueAdd.toLocaleString()} (${result.twoBathARV.valueAddPercent.toFixed(1)}%)`);
      console.log(`   ROI: ${result.twoBathARV.roiEstimate?.toFixed(1)}%`);
    }

  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testComprehensiveSearchV3().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  });
}