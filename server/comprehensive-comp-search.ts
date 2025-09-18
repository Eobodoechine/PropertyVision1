import { VertexComparableSearchService } from './step3-find-comparables.js';
import { fetchPropertyDetailsViaVertex } from './vertex-details.js';

interface ComprehensiveSearchResult {
  all_comps: any[];
  qualified_comps: any[];
  consistency_scores: Map<string, number>;
  renovation_analysis: {
    likely_renovated: any[];
    likely_unrenovated: any[];
    market_average: any[];
  };
}

export class ComprehensiveCompSearch {
  private compService: VertexComparableSearchService;

  constructor() {
    this.compService = new VertexComparableSearchService();
  }

  async performOptimalSearch(
    address: string,
    subjectDetails?: { sqft: number; beds: number; baths: number; yearBuilt: number }
  ): Promise<ComprehensiveSearchResult> {

    console.log('🎯 COMPREHENSIVE 4-SEARCH STRATEGY');
    console.log('============================================================');
    console.log(`📍 Subject: ${address}`);
    console.log('');

    const allComps = new Map<string, any>();
    const compFrequency = new Map<string, number>();

    // Ensure subject details are available (used by parse/filters/enrichment in the service)
    if (!subjectDetails) {
      try {
        const details = await fetchPropertyDetailsViaVertex(address);
        if (details && details.sqft && details.beds && details.baths && details.yearBuilt) {
          subjectDetails = {
            sqft: details.sqft,
            beds: details.beds,
            baths: details.baths as number,
            yearBuilt: details.yearBuilt,
          };
          console.log(`   🧩 Subject details: ${subjectDetails.sqft} sqft | ${subjectDetails.beds}bd/${subjectDetails.baths}ba | Built ${subjectDetails.yearBuilt}`);
        } else {
          console.log(`   ⚠️  Subject details incomplete; continuing without strict subject filters.`);
        }
      } catch (e: any) {
        console.log(`   ⚠️  Failed to fetch subject details: ${e?.message || e}`);
      }
    }

    // SEARCH 1: Primary (Subdivision-focused)
    console.log('🏘️  SEARCH 1: SUBDIVISION-FOCUSED');
    console.log('------------------------------------------------------------');
    const originalSubdivision = process.env.SUBDIVISION;
    // Set subdivision from property details (if available)
    if (subjectDetails) {
      // subjectDetails doesn't include subdivision; fetchDetailsViaVertex handled above
    }
    try {
      const details = await fetchPropertyDetailsViaVertex(address);
      const subdivision = (details && typeof details.subdivision === 'string' && details.subdivision.trim()) ? details.subdivision.trim() : '';
      process.env.SUBDIVISION = subdivision;
      if (subdivision) {
        console.log(`   🏘️  Setting subdivision: ${subdivision}`);
      } else {
        console.log('   🏘️  No subdivision found; running without subdivision filter');
      }
    } catch {
      process.env.SUBDIVISION = '';
      console.log('   🏘️  Subdivision lookup failed; running without subdivision filter');
    }

    const search1 = await this.compService.findComparables(address, undefined, 50, 3, 18, subjectDetails);
    this.processSearchResults(search1, 'subdivision', allComps, compFrequency);

    // SEARCH 2: Secondary (Broader area)
    console.log('🌍 SEARCH 2: BROADER AREA');
    console.log('------------------------------------------------------------');
    process.env.SUBDIVISION = ''; // Remove subdivision filter

    const search2 = await this.compService.findComparables(address, undefined, 50, 3, 18, subjectDetails);
    this.processSearchResults(search2, 'broader', allComps, compFrequency);

    // SEARCH 3: Consistency validation
    console.log('🔄 SEARCH 3: CONSISTENCY VALIDATION');
    console.log('------------------------------------------------------------');
    await new Promise(resolve => setTimeout(resolve, 2000)); // Rate limiting

    const search3 = await this.compService.findComparables(address, undefined, 50, 3, 18, subjectDetails);
    this.processSearchResults(search3, 'consistency', allComps, compFrequency);

    // SEARCH 4: Fallback (only if needed)
    let search4Results = null;
    const qualifiedSoFar = Array.from(allComps.values()).filter(comp =>
      compFrequency.get(comp.address) >= 1 // Using 1+ appearance rule
    );

    if (qualifiedSoFar.length < 3) {
      console.log('🆘 SEARCH 4: FALLBACK (INSUFFICIENT COMPS)');
      console.log('------------------------------------------------------------');
      console.log(`   Only ${qualifiedSoFar.length} qualified comps found, expanding criteria...`);

      try {
        // Expand to 75 results, 4 miles and 24 months
        const search4 = await this.compService.findComparables(address, undefined, 75, 4, 24, subjectDetails);
        search4Results = this.processSearchResults(search4, 'fallback', allComps, compFrequency);
      } catch (error: any) {
        console.log(`   ⚠️  Search 4 failed or timed out: ${error.message}`);
        console.log(`   📊 Proceeding with available ${qualifiedSoFar.length} comps...`);
      }
    } else {
      console.log('✅ SEARCH 4: SKIPPED (SUFFICIENT COMPS FOUND)');
      console.log('------------------------------------------------------------');
      console.log(`   ${qualifiedSoFar.length} qualified comps found, no fallback needed`);
    }

    // Restore original subdivision setting
    process.env.SUBDIVISION = originalSubdivision;

    // Analyze results
    return this.analyzeComprehensiveResults(allComps, compFrequency);
  }

  private processSearchResults(
    searchResult: any,
    searchType: string,
    allComps: Map<string, any>,
    frequency: Map<string, number>
  ): void {
    if (searchResult.success && searchResult.comparables.length > 0) {
      console.log(`   ✅ Found ${searchResult.comparables.length} comps in ${searchType} search`);

      searchResult.comparables.forEach((comp: any) => {
        const key = comp.address;
        if (!allComps.has(key)) {
          allComps.set(key, { ...comp, first_found_in: searchType });
        }
        frequency.set(key, (frequency.get(key) || 0) + 1);
      });
    } else {
      console.log(`   ❌ No comps found in ${searchType} search`);
    }
  }

  private analyzeComprehensiveResults(
    allComps: Map<string, any>,
    frequency: Map<string, number>
  ): ComprehensiveSearchResult {

    console.log('');
    console.log('📊 COMPREHENSIVE ANALYSIS RESULTS');
    console.log('============================================================');

    const allCompsArray = Array.from(allComps.values());

    // Filter by consistency (appeared 1+ times - using best comps from any single search)
    const qualifiedComps = allCompsArray.filter(comp =>
      frequency.get(comp.address)! >= 1
    );

    console.log(`🔢 Total unique comps found: ${allCompsArray.length}`);
    console.log(`✅ Qualified comps (1+ appearances): ${qualifiedComps.length}`);

    // Renovation analysis
    const renovationAnalysis = this.categorizePropsByRenovationStatus(qualifiedComps);

    console.log('');
    console.log('🏠 RENOVATION STATUS ANALYSIS:');
    console.log(`   🔧 Likely Renovated: ${renovationAnalysis.likely_renovated.length} comps (use for ARV)`);
    console.log(`   🔨 Likely Unrenovated: ${renovationAnalysis.likely_unrenovated.length} comps (exclude from ARV)`);
    console.log(`   📊 Market Average: ${renovationAnalysis.market_average.length} comps (baseline)`);

    return {
      all_comps: allCompsArray,
      qualified_comps: qualifiedComps,
      consistency_scores: frequency,
      renovation_analysis: renovationAnalysis
    };
  }

  private categorizePropsByRenovationStatus(comps: any[]): {
    likely_renovated: any[];
    likely_unrenovated: any[];
    market_average: any[];
  } {
    if (comps.length < 2) {
      // Insufficient data for any analysis
      console.log(`   ❌ Insufficient data (${comps.length} comps) - need minimum 2 comps for renovation analysis`);
      return {
        likely_renovated: [],
        likely_unrenovated: [],
        market_average: comps // Use all as baseline
      };
    }

    if (comps.length < 4) {
      // Limited data - use simple high/low split instead of quartiles
      console.log(`   ⚠️  Limited data (${comps.length} comps) - using simplified renovation detection`);

      const ppsfValues = comps.map(c => c.price / c.sqft).sort((a, b) => a - b);

      if (comps.length === 2) {
        // With 2 comps: lowest = unrenovated, highest = renovated
        const [lowPpsf, highPpsf] = ppsfValues;
        console.log(`   💲 PPSF range: $${lowPpsf.toFixed(2)} (unrenovated) → $${highPpsf.toFixed(2)} (renovated)`);

        const likely_unrenovated = comps.filter(c => c.price / c.sqft === lowPpsf);
        const likely_renovated = comps.filter(c => c.price / c.sqft === highPpsf);

        return { likely_renovated, likely_unrenovated, market_average: [] };
      } else {
        // With 3 comps: use median split
        const median = ppsfValues[Math.floor(ppsfValues.length / 2)];
        console.log(`   💲 Median PPSF: $${median.toFixed(2)} (renovation threshold)`);

        const likely_renovated = comps.filter(c => {
          const ppsf = c.price / c.sqft;
          return ppsf >= median; // Above median = likely renovated
        });

        const likely_unrenovated = comps.filter(c => {
          const ppsf = c.price / c.sqft;
          return ppsf < median; // Below median = likely unrenovated
        });

        return { likely_renovated, likely_unrenovated, market_average: [] };
      }
    }

    const ppsfValues = comps.map(c => c.price / c.sqft).sort((a, b) => a - b);

    // Calculate quartiles for renovation status detection
    const q1 = ppsfValues[Math.floor(ppsfValues.length * 0.25)]; // 25th percentile
    const q3 = ppsfValues[Math.floor(ppsfValues.length * 0.75)]; // 75th percentile

    console.log(`   💲 PPSF Analysis: Q1=$${q1.toFixed(2)}, Q3=$${q3.toFixed(2)}`);

    const likely_unrenovated = comps.filter(c => {
      const ppsf = c.price / c.sqft;
      return ppsf <= q1; // Bottom quartile - likely needs work
    });

    const likely_renovated = comps.filter(c => {
      const ppsf = c.price / c.sqft;
      return ppsf >= q3; // Top quartile - likely renovated
    });

    const market_average = comps.filter(c => {
      const ppsf = c.price / c.sqft;
      return ppsf > q1 && ppsf < q3; // Middle 50%
    });

    // Log details
    console.log(`   🔧 Renovated Comps (PPSF ≥ $${q3.toFixed(2)}):`);
    likely_renovated.forEach(c => {
      const ppsf = c.price / c.sqft;
      console.log(`      ${c.address} - $${ppsf.toFixed(2)} PPSF`);
    });

    console.log(`   🔨 Unrenovated Comps (PPSF ≤ $${q1.toFixed(2)}):`);
    likely_unrenovated.forEach(c => {
      const ppsf = c.price / c.sqft;
      console.log(`      ${c.address} - $${ppsf.toFixed(2)} PPSF`);
    });

    return { likely_renovated, likely_unrenovated, market_average };
  }
}
