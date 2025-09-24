// Comprehensive Comparable Search V2 - Fixed Version
// Integrates all improvements: normalization, deduplication, progressive expansion, distance validation
import { VertexComparableSearchService } from './step3-find-comparables.js';
import { ARVCalculationService } from './step4-arv-calculation.js';
import { fetchPropertyDetailsViaVertex } from './vertex-details.js';
import { PropertyDataNormalizer } from './utils/propertyDataNormalizer.js';
import { SmartDeduplicator } from './utils/smartDeduplicator.js';
import { ProgressiveSearchStrategy } from './utils/progressiveSearchStrategy.js';
import { DistanceValidator } from './utils/distanceValidator.js';
export class ComprehensiveCompSearchV2 {
    constructor() {
        this.compService = new VertexComparableSearchService();
        this.arvService = new ARVCalculationService();
        this.normalizer = new PropertyDataNormalizer();
        this.deduplicator = new SmartDeduplicator();
        this.progressiveSearch = new ProgressiveSearchStrategy();
        this.distanceValidator = new DistanceValidator();
    }
    async performOptimalSearchV2(address, subjectDetails) {
        const searchStartTime = Date.now();
        console.log('🎯 COMPREHENSIVE SEARCH V2 - FIXED VERSION');
        console.log('===========================================');
        console.log(`📍 Subject: ${address}`);
        console.log('');
        // Step 1: Ensure subject details are available
        if (!subjectDetails) {
            try {
                const details = await fetchPropertyDetailsViaVertex(address);
                if (details && details.sqft && details.beds && details.baths && details.yearBuilt) {
                    subjectDetails = {
                        sqft: details.sqft,
                        beds: details.beds,
                        baths: details.baths,
                        yearBuilt: details.yearBuilt,
                        subdivision: details.subdivision || undefined,
                    };
                    const subdivisionText = details.subdivision ? ` | ${details.subdivision}` : '';
                    console.log(`   🧩 Subject details: ${subjectDetails.sqft} sqft | ${subjectDetails.beds}bd/${subjectDetails.baths}ba | Built ${subjectDetails.yearBuilt}${subdivisionText}`);
                }
                else {
                    console.log(`   ⚠️  Subject details incomplete; using progressive search without strict filters.`);
                }
            }
            catch (e) {
                console.log(`   ⚠️  Failed to fetch subject details: ${e?.message || e}`);
            }
        }
        // Step 2: Execute Progressive Search Strategy
        console.log('\n🔍 STEP 2: PROGRESSIVE EXPANSION SEARCH');
        console.log('---------------------------------------');
        const progressiveResult = await this.progressiveSearch.executeProgressiveSearch(address, subjectDetails, this.compService, subjectDetails?.subdivision);
        let rawProperties = progressiveResult.finalProperties;
        console.log(`✅ Progressive search found ${rawProperties.length} raw properties`);
        if (rawProperties.length === 0) {
            console.log('❌ No properties found - returning empty result');
            return this.createEmptyResult(searchStartTime, progressiveResult);
        }
        // Step 3: Property Data Normalization
        console.log('\n🔧 STEP 3: PROPERTY DATA NORMALIZATION');
        console.log('--------------------------------------');
        const normalizationResult = this.normalizer.processProperties(rawProperties);
        console.log(`✅ Normalization: ${normalizationResult.summary.originalCount} → ${normalizationResult.summary.finalCount} properties`);
        // Step 4: Smart Deduplication
        console.log('\n🔗 STEP 4: SMART DEDUPLICATION');
        console.log('------------------------------');
        const deduplicationResult = this.deduplicator.deduplicateProperties(normalizationResult.normalized);
        console.log(`✅ Deduplication: ${deduplicationResult.summary.originalCount} → ${deduplicationResult.summary.finalCount} properties`);
        // Step 5: Distance Validation
        console.log('\n📍 STEP 5: DISTANCE VALIDATION');
        console.log('------------------------------');
        const distanceResult = await this.distanceValidator.validateComparableDistances(address, deduplicationResult.deduplicated, 2.0 // 2 mile max distance
        );
        console.log(`✅ Distance validation: ${distanceResult.validationSummary.validCount}/${distanceResult.validationSummary.totalProcessed} passed`);
        const qualifiedComps = distanceResult.validated;
        if (qualifiedComps.length === 0) {
            console.log('❌ No properties passed distance validation - returning empty result');
            return this.createEmptyResult(searchStartTime, progressiveResult);
        }
        // Step 6: Consistency Analysis
        console.log('\n📊 STEP 6: CONSISTENCY ANALYSIS');
        console.log('-------------------------------');
        const consistencyScores = this.calculateConsistencyScores(qualifiedComps);
        const renovationAnalysis = this.analyzeRenovationStatus(qualifiedComps, subjectDetails);
        // Step 7: ARV Calculation
        console.log('\n💰 STEP 7: ARV CALCULATION');
        console.log('-------------------------');
        let arv = undefined;
        if (subjectDetails && qualifiedComps.length >= 3) {
            try {
                const renovatedComps = renovationAnalysis.likely_renovated.length >= 3
                    ? renovationAnalysis.likely_renovated
                    : qualifiedComps;
                console.log(`   🎯 Using ${renovatedComps.length} comps for ARV calculation`);
                arv = await this.arvService.calculateARV(renovatedComps, subjectDetails.sqft);
                console.log(`   💰 ARV: $${arv.estimate.toLocaleString()} (${arv.confidence} confidence)`);
            }
            catch (e) {
                console.log(`   ⚠️  ARV calculation failed: ${e?.message || e}`);
            }
        }
        else {
            console.log(`   ⚠️  Insufficient data for ARV: ${qualifiedComps.length} comps, subject details: ${!!subjectDetails}`);
        }
        // Step 8: Compile Results
        const totalSearchTime = Date.now() - searchStartTime;
        console.log('\n📋 FINAL RESULTS SUMMARY');
        console.log('========================');
        console.log(`⏱️  Total processing time: ${totalSearchTime}ms`);
        console.log(`🔍 Search strategy: Progressive expansion (${progressiveResult.searchHistory.length} levels)`);
        console.log(`📊 Quality score: ${progressiveResult.summary.qualityScore.toUpperCase()}`);
        console.log(`🏠 Final qualified comps: ${qualifiedComps.length}`);
        console.log(`💰 ARV: ${arv ? `$${arv.estimate.toLocaleString()}` : 'Not calculated'}`);
        return {
            all_comps: rawProperties,
            qualified_comps: qualifiedComps,
            consistency_scores: consistencyScores,
            renovation_analysis: renovationAnalysis,
            arv,
            searchMetadata: {
                version: '2.0',
                strategy: 'progressive_expansion',
                searchLevels: progressiveResult.searchHistory.length,
                totalSearchTime,
                qualityScore: progressiveResult.summary.qualityScore,
                cacheHits: progressiveResult.summary.cacheHits,
                normalizationSummary: normalizationResult.summary,
                deduplicationSummary: deduplicationResult.summary,
                distanceValidationSummary: distanceResult.validationSummary
            }
        };
    }
    /**
     * Calculate consistency scores based on appearance frequency
     */
    calculateConsistencyScores(properties) {
        const scores = new Map();
        properties.forEach(prop => {
            const key = prop.address;
            const appearances = prop.mergedFrom || 1;
            scores.set(key, appearances);
        });
        return scores;
    }
    /**
     * Analyze renovation status of comparables
     */
    analyzeRenovationStatus(properties, subjectDetails) {
        if (!subjectDetails) {
            return {
                likely_renovated: properties,
                likely_unrenovated: [],
                market_average: []
            };
        }
        // Calculate price per square foot for all properties
        const ppsf = properties
            .map(p => p.price / p.sqft)
            .filter(p => !isNaN(p) && p > 0);
        if (ppsf.length === 0) {
            return {
                likely_renovated: properties,
                likely_unrenovated: [],
                market_average: []
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
    /**
     * Create empty result structure
     */
    createEmptyResult(searchStartTime, progressiveResult) {
        return {
            all_comps: [],
            qualified_comps: [],
            consistency_scores: new Map(),
            renovation_analysis: {
                likely_renovated: [],
                likely_unrenovated: [],
                market_average: []
            },
            searchMetadata: {
                version: '2.0',
                strategy: 'progressive_expansion',
                searchLevels: progressiveResult?.searchHistory?.length || 0,
                totalSearchTime: Date.now() - searchStartTime,
                qualityScore: 'poor',
                cacheHits: progressiveResult?.summary?.cacheHits || 0,
                normalizationSummary: null,
                deduplicationSummary: null,
                distanceValidationSummary: null
            }
        };
    }
    /**
     * Clear all caches (useful for testing)
     */
    clearAllCaches() {
        this.normalizer.reset();
        this.deduplicator.reset();
        this.progressiveSearch.clearCache();
        this.distanceValidator.clearCaches();
        console.log('🗑️  All V2 caches cleared');
    }
    /**
     * Get system statistics
     */
    getSystemStats() {
        return {
            progressiveSearchCache: this.progressiveSearch.getCacheStats(),
            distanceValidatorCache: this.distanceValidator.getCacheStats(),
            version: '2.0'
        };
    }
}
