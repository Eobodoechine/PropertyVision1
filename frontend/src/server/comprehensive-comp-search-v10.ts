// Comprehensive Comparable Search V10 - Parallel Search with Progressive Qualification
// All 4 search levels run in parallel, progressive qualification passes

import './utils/logger';

import { fetchPropertyDetailsViaVertex, type BasicDetails } from './vertex-details';
import { PropertyDataNormalizer } from './utils/propertyDataNormalizer';
import { VertexDeduplicator } from './utils/vertexDeduplicator';
import { ARVCalculator } from './arvCalculator';
import { updateJobProgress, isJobCancelled } from './utils/jobQueue';
import { ParallelSearchOrchestrator } from './utils/parallelSearchOrchestrator';
import { parallelSearchConfig } from './utils/parallelSearchConfig';

interface ComprehensiveSearchResultV10 {
  subject: SubjectSummary;
  all_comps: any[];
  qualified_comps: any[];
  consistency_scores: Map<string, number>;
  renovation_analysis: {
    likely_renovated: any[];
    likely_unrenovated: any[];
    market_average: any[];
  };
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
  bathroomAnalysis?: {
    subjectBaths: number;
    recommendAction: 'hold' | 'renovate' | 'sell_as_is';
    baselineCompsUsed: number;
    upgradeCompsUsed?: number;
  };
  searchMetadata: {
    version: string;
    strategy: 'parallel_immediate';
    searchLevels: number;
    totalSearchTime: number;
    qualityScore: 'excellent' | 'good' | 'fair' | 'poor';
    cacheHits: number;
    normalizationSummary: any;
    deduplicationSummary: any;
    distanceValidationSummary: any;
    parallelMetrics?: any;
  };
}

type SubjectSummary = Pick<BasicDetails,
  'address' | 'sqft' | 'beds' | 'baths' | 'yearBuilt' | 'lotSize' | 'subdivision' | 'success'
>;

export class ComprehensiveComparableSearchV10 {
  private arvCalculator: ARVCalculator;
  private normalizer: PropertyDataNormalizer;
  private deduplicator: VertexDeduplicator;
  private parallelOrchestrator: ParallelSearchOrchestrator;

  constructor() {
    this.arvCalculator = new ARVCalculator();
    this.normalizer = new PropertyDataNormalizer();
    this.deduplicator = new VertexDeduplicator();
    this.parallelOrchestrator = new ParallelSearchOrchestrator();

    console.log(`\n🚀 COMPREHENSIVE COMPARABLE SEARCH V10 INITIALIZED`);
    console.log(`   Parallel search enabled: ${parallelSearchConfig.enabled}`);
    console.log(`   Vertex concurrency: ${parallelSearchConfig.vertexLocalConcurrency}`);
    console.log(`   Levels: ${parallelSearchConfig.levels.join(',')}`);
  }

  async findComparables(address: string): Promise<ComprehensiveSearchResultV10> {
    const startTime = Date.now();
    console.log(`\n🔍 COMPREHENSIVE COMPARABLE SEARCH V10 - Parallel Immediate Mode`);
    console.log(`============================================================`);
    console.log(`📍 Analyzing: ${address}`);

    try {
      // Step 1: Get subject property details
      console.log(`\n📋 Step 1: Subject Property Research`);

      try {
        await updateJobProgress('SUBJECT_PROPERTY');
      } catch (error) {
        console.error(`❌ [SUBJECT_PROPERTY] ERROR updating job progress:`);
        console.error(`   Error type: ${typeof error}`);
        console.error(`   Error message: ${error instanceof Error ? error.message : String(error)}`);
        console.error(`   Error stack:`, error instanceof Error ? error.stack : 'N/A');
        console.error(`   Context: stage=SUBJECT_PROPERTY, address=${address}`);
        // Continue execution - progress update failure is non-critical
      }

      let subjectDetails;
      try {
        subjectDetails = await fetchPropertyDetailsViaVertex(address);
      } catch (error) {
        console.error(`❌ [VERTEX_DETAILS] ERROR fetching subject property details:`);
        console.error(`   Error type: ${typeof error}`);
        console.error(`   Error message: ${error instanceof Error ? error.message : String(error)}`);
        console.error(`   Error stack:`, error instanceof Error ? error.stack : 'N/A');
        console.error(`   Context: address=${address}`);
        throw error; // Critical - cannot proceed without subject details
      }

      if (!subjectDetails) {
        throw new Error('Could not fetch subject property details');
      }

      console.log(`   ✅ Subject: ${subjectDetails.beds}BR/${subjectDetails.baths}BA, ${subjectDetails.sqft}sqft, Built ${subjectDetails.yearBuilt}`);
      if (subjectDetails.subdivision) {
        console.log(`   🏘️  Subdivision: ${subjectDetails.subdivision}`);
      }

      // Step 2: Parallel comparable search
      console.log(`\n🔥 Step 2: Parallel Comparable Search (V10)`);

      try {
        await updateJobProgress('COMPARABLE_SEARCH_L1'); // Update to L1 to show search started
      } catch (error) {
        console.error(`❌ [COMPARABLE_SEARCH_L1] ERROR updating job progress:`);
        console.error(`   Error type: ${typeof error}`);
        console.error(`   Error message: ${error instanceof Error ? error.message : String(error)}`);
        console.error(`   Error stack:`, error instanceof Error ? error.stack : 'N/A');
        console.error(`   Context: stage=COMPARABLE_SEARCH_L1, address=${address}`);
        // Continue execution - progress update failure is non-critical
      }

      const subjectPropertyType = subjectDetails.propertyType || undefined;
      console.log(`   🏠 Property Type: ${subjectPropertyType || 'Not specified'}`);

      // Execute parallel search
      let parallelResult;
      try {
        parallelResult = await this.parallelOrchestrator.executeParallelSearch(
          {
            address: subjectDetails.address,
            sqft: subjectDetails.sqft || undefined,
            beds: subjectDetails.beds || undefined,
            baths: subjectDetails.baths || undefined,
            yearBuilt: subjectDetails.yearBuilt || undefined,
            subdivision: subjectDetails.subdivision || undefined,
            propertyType: subjectPropertyType,
          },
          subjectPropertyType
        );
      } catch (error) {
        console.error(`❌ [PARALLEL_SEARCH] ERROR executing parallel search:`);
        console.error(`   Error type: ${typeof error}`);
        console.error(`   Error message: ${error instanceof Error ? error.message : String(error)}`);
        console.error(`   Error stack:`, error instanceof Error ? error.stack : 'N/A');
        console.error(`   Context: address=${subjectDetails.address}, beds=${subjectDetails.beds}, baths=${subjectDetails.baths}, sqft=${subjectDetails.sqft}`);
        throw error; // Critical - cannot proceed without search results
      }

      const allComps = parallelResult.qualifiedComps;
      console.log(`   📊 Parallel search complete: ${allComps.length} qualified comps in ${parallelResult.searchMetadata.totalSearchTime}ms`);

      if (allComps.length === 0) {
        console.log(`\n❌ EARLY TERMINATION: No comparable properties found`);
        console.log(`   🏠 Subject property exists but no recent sales in area`);
        console.log(`   💡 Reason: Rural/sparse market with insufficient transaction data`);
        console.log(`   📊 FINAL RESULT: Analysis terminated - no ARV calculation possible`);

        const subjectSummary = this.buildSubjectSummary(address, subjectDetails);
        const endTime = Date.now();

        return {
          subject: subjectSummary,
          all_comps: [],
          qualified_comps: [],
          consistency_scores: new Map(),
          renovation_analysis: {
            likely_renovated: [],
            likely_unrenovated: [],
            market_average: []
          },
          arv: {
            method: 'no-data',
            estimate: 0,
            confidence: 'low' as const,
            dataPoints: 0
          },
          bathroomAnalysis: {
            subjectBaths: subjectDetails?.baths || 1,
            recommendAction: 'sell_as_is' as const,
            baselineCompsUsed: 0
          },
          searchMetadata: {
            version: 'V10',
            strategy: 'parallel_immediate',
            searchLevels: parallelSearchConfig.levels.length,
            totalSearchTime: endTime - startTime,
            qualityScore: 'poor' as const,
            cacheHits: 0,
            normalizationSummary: {},
            deduplicationSummary: {},
            distanceValidationSummary: {},
            parallelMetrics: parallelResult.searchMetadata
          }
        };
      }

      // Step 3: Data Normalization
      console.log(`\n🔧 Step 3: Data Normalization`);
      let normalizationResult;
      try {
        normalizationResult = this.normalizer.processProperties(allComps);
        console.log(`   ✅ Normalized ${normalizationResult.normalized.length}/${normalizationResult.summary.originalCount} properties`);
        console.log(`   📊 Normalization: ${normalizationResult.summary.duplicatesFound} duplicates, ${normalizationResult.summary.conflictsResolved} conflicts resolved`);
      } catch (error) {
        console.error(`❌ [NORMALIZATION] ERROR normalizing properties:`);
        console.error(`   Error type: ${typeof error}`);
        console.error(`   Error message: ${error instanceof Error ? error.message : String(error)}`);
        console.error(`   Error stack:`, error instanceof Error ? error.stack : 'N/A');
        console.error(`   Context: compCount=${allComps.length}, address=${address}`);
        throw error; // Critical - cannot proceed without normalized data
      }

      // Step 4: Deduplication
      console.log(`\n🤖 Step 4: Vertex AI Deduplication`);

      try {
        await updateJobProgress('DEDUPLICATION');
      } catch (error) {
        console.error(`❌ [DEDUPLICATION] ERROR updating job progress:`);
        console.error(`   Error type: ${typeof error}`);
        console.error(`   Error message: ${error instanceof Error ? error.message : String(error)}`);
        console.error(`   Error stack:`, error instanceof Error ? error.stack : 'N/A');
        console.error(`   Context: stage=DEDUPLICATION, address=${address}`);
        // Continue execution - progress update failure is non-critical
      }

      let dedupResult;
      try {
        dedupResult = await this.deduplicator.deduplicateProperties(normalizationResult.normalized);
        console.log(`   ✅ Deduplication: ${allComps.length} → ${dedupResult.uniqueProperties.length} unique (removed ${dedupResult.duplicatesRemoved} duplicates)`);
      } catch (error) {
        console.error(`❌ [DEDUPLICATION] ERROR deduplicating properties:`);
        console.error(`   Error type: ${typeof error}`);
        console.error(`   Error message: ${error instanceof Error ? error.message : String(error)}`);
        console.error(`   Error stack:`, error instanceof Error ? error.stack : 'N/A');
        console.error(`   Context: normalizedCount=${normalizationResult.normalized.length}, address=${address}`);
        throw error; // Critical - cannot proceed without deduplication
      }

      const finalComps = dedupResult.uniqueProperties;

      // Step 5: ARV Calculation
      console.log(`\n🧮 Step 6: ARV Calculation (PPSF Clustering)`);

      try {
        await updateJobProgress('ARV_CALCULATION');
      } catch (error) {
        console.error(`❌ [ARV_CALCULATION] ERROR updating job progress:`);
        console.error(`   Error type: ${typeof error}`);
        console.error(`   Error message: ${error instanceof Error ? error.message : String(error)}`);
        console.error(`   Error stack:`, error instanceof Error ? error.stack : 'N/A');
        console.error(`   Context: stage=ARV_CALCULATION, address=${address}`);
        // Continue execution - progress update failure is non-critical
      }

      console.log(`   📊 Calculating ARV with ${finalComps.length} comps using PPSF clustering algorithm...`);

      let arvResult;
      try {
        // Defensive check: ensure finalComps is an array
        if (!Array.isArray(finalComps)) {
          throw new Error(`finalComps is not an array (type: ${typeof finalComps}), cannot calculate ARV`);
        }

        // ARVCalculator expects subject object and comparables array
        const subject = {
          sqft: subjectDetails.sqft || 0,
          beds: subjectDetails.beds || 0,
          baths: subjectDetails.baths || 0
        };

        const rawResult = this.arvCalculator.calculateARV(subject, finalComps);

        // Transform ARVCalculator result to V10 expected format
        const confidence: 'high' | 'medium' | 'low' =
          rawResult.flags?.thin_market ? 'low' :
          rawResult.flags?.mixed_types ? 'medium' : 'high';

        arvResult = {
          arv: {
            method: rawResult.method_used || 'unknown',
            estimate: rawResult.aggressive?.arv_price || rawResult.conservative?.arv_price || 0,
            confidence,
            dataPoints: rawResult.kept_comps?.length || 0
          },
          likely_renovated: [],
          likely_unrenovated: [],
          market_average: rawResult.kept_comps || [],
          twoBathARV: undefined,
          bathroomAnalysis: undefined
        };

        // Check if ARV is 0 or unavailable - this is a failed run
        if (arvResult.arv.estimate === 0 || arvResult.arv.method === 'no-data' || arvResult.arv.method === 'unknown') {
          console.error(`❌ ARV UNAVAILABLE: ARV=$${arvResult.arv.estimate}, method=${arvResult.arv.method}`);
          throw new Error(`ARV unavailable (estimate: $${arvResult.arv.estimate}, method: ${arvResult.arv.method})`);
        }

        console.log(`   ✅ ARV Result: $${arvResult.arv.estimate.toLocaleString()} (${arvResult.arv.method}, confidence: ${arvResult.arv.confidence})`);
        console.log(`   📊 Comps Used: ${arvResult.arv.dataPoints} out of ${finalComps.length} qualified comps`);
      } catch (error) {
        console.error(`❌ [ARV_CALCULATION] ERROR calculating ARV:`);
        console.error(`   Error type: ${typeof error}`);
        console.error(`   Error message: ${error instanceof Error ? error.message : String(error)}`);
        console.error(`   Error stack:`, error instanceof Error ? error.stack : 'N/A');
        console.error(`   Context: compCount=${finalComps.length}, sqft=${subjectDetails.sqft}, beds=${subjectDetails.beds}, baths=${subjectDetails.baths}, address=${address}`);
        throw error; // Critical - cannot proceed without valid ARV calculation
      }

      // Step 7: Renovation Analysis
      console.log(`\n🔨 Step 7: Renovation Analysis`);
      const renovationAnalysis = {
        likely_renovated: arvResult.likely_renovated || [],
        likely_unrenovated: arvResult.likely_unrenovated || [],
        market_average: arvResult.market_average || []
      };

      // Build final result
      const subjectSummary = this.buildSubjectSummary(address, subjectDetails);
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      console.log(`\n📊 COMPREHENSIVE SEARCH V10 COMPLETE`);
      console.log(`   Total Time: ${totalTime}ms (${(totalTime / 1000).toFixed(1)}s)`);
      console.log(`   Parallel Search: ${parallelResult.searchMetadata.totalSearchTime}ms`);
      console.log(`   ARV: $${arvResult.arv.estimate.toLocaleString()} (${arvResult.arv.method})`);
      console.log(`   Comps Used: ${finalComps.length}`);

      return {
        subject: subjectSummary,
        all_comps: allComps,
        qualified_comps: finalComps,
        consistency_scores: new Map(),
        renovation_analysis: renovationAnalysis,
        arv: arvResult.arv,
        twoBathARV: arvResult.twoBathARV,
        bathroomAnalysis: arvResult.bathroomAnalysis,
        searchMetadata: {
          version: 'V10',
          strategy: 'parallel_immediate',
          searchLevels: parallelSearchConfig.levels.length,
          totalSearchTime: totalTime,
          qualityScore: this.assessQualityScore(finalComps.length),
          cacheHits: parallelResult.searchMetadata.cacheHits,
          normalizationSummary: normalizationResult.summary,
          deduplicationSummary: {
            duplicatesRemoved: dedupResult.duplicatesRemoved,
            uniqueProperties: dedupResult.uniqueProperties.length
          },
          distanceValidationSummary: {},
          parallelMetrics: parallelResult.searchMetadata
        }
      };

    } catch (error) {
      console.error(`❌ COMPREHENSIVE SEARCH V10 FATAL ERROR:`, error);
      console.error(`   Error type: ${typeof error}`);
      console.error(`   Error message: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`   Error stack:`, error instanceof Error ? error.stack : 'N/A');
      throw error;
    }
  }

  private buildSubjectSummary(address: string, details: BasicDetails): SubjectSummary {
    return {
      address,
      sqft: details.sqft,
      beds: details.beds,
      baths: details.baths,
      yearBuilt: details.yearBuilt,
      lotSize: details.lotSize,
      subdivision: details.subdivision,
      success: details.success
    };
  }

  private assessQualityScore(compCount: number): 'excellent' | 'good' | 'fair' | 'poor' {
    if (compCount >= 10) return 'excellent';
    if (compCount >= 6) return 'good';
    if (compCount >= 3) return 'fair';
    return 'poor';
  }
}
