import { VertexComparableSearchService } from './step3-find-comparables.js';
import { ARVCalculationService } from './step4-arv-calculation.js';
import { fetchPropertyDetailsViaVertex } from './vertex-details.js';
export class ComprehensiveCompSearch {
    constructor() {
        this.compService = new VertexComparableSearchService();
        this.arvService = new ARVCalculationService();
    }
    async performOptimalSearch(address, subjectDetails) {
        console.log('🎯 COMPREHENSIVE 4-SEARCH STRATEGY');
        console.log('============================================================');
        console.log(`📍 Subject: ${address}`);
        console.log('');
        const allComps = new Map();
        const compFrequency = new Map();
        // Ensure subject details are available (used by parse/filters/enrichment in the service)
        if (!subjectDetails) {
            try {
                const details = await fetchPropertyDetailsViaVertex(address);
                if (details && details.sqft && details.beds && details.baths && details.yearBuilt) {
                    subjectDetails = {
                        sqft: details.sqft,
                        beds: details.beds,
                        baths: details.baths,
                        yearBuilt: details.yearBuilt,
                    };
                    console.log(`   🧩 Subject details: ${subjectDetails.sqft} sqft | ${subjectDetails.beds}bd/${subjectDetails.baths}ba | Built ${subjectDetails.yearBuilt}`);
                }
                else {
                    console.log(`   ⚠️  Subject details incomplete; continuing without strict subject filters.`);
                }
            }
            catch (e) {
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
            }
            else {
                console.log('   🏘️  No subdivision found; running without subdivision filter');
            }
        }
        catch {
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
        const search3 = await this.compService.findComparables(address, undefined, 50, 3, 18, subjectDetails);
        this.processSearchResults(search3, 'consistency', allComps, compFrequency);
        // SEARCH 4: Fallback (only if needed)
        let search4Results = null;
        const qualifiedSoFar = Array.from(allComps.values()).filter(comp => compFrequency.get(comp.address) >= 1 // Using 1+ appearance rule
        );
        if (qualifiedSoFar.length < 3) {
            console.log('🆘 SEARCH 4: FALLBACK (INSUFFICIENT COMPS)');
            console.log('------------------------------------------------------------');
            console.log(`   Only ${qualifiedSoFar.length} qualified comps found, expanding criteria...`);
            try {
                // Expand to 75 results, 4 miles and 24 months
                const search4 = await this.compService.findComparables(address, undefined, 75, 4, 24, subjectDetails);
                search4Results = this.processSearchResults(search4, 'fallback', allComps, compFrequency);
            }
            catch (error) {
                console.log(`   ⚠️  Search 4 failed or timed out: ${error.message}`);
                console.log(`   📊 Proceeding with available ${qualifiedSoFar.length} comps...`);
            }
        }
        else {
            console.log('✅ SEARCH 4: SKIPPED (SUFFICIENT COMPS FOUND)');
            console.log('------------------------------------------------------------');
            console.log(`   ${qualifiedSoFar.length} qualified comps found, no fallback needed`);
        }
        // Restore original subdivision setting
        process.env.SUBDIVISION = originalSubdivision;
        // Analyze results
        const analysis = this.analyzeComprehensiveResults(allComps, compFrequency);
        // Feed ARV calculator using renovated-only comps when subject sqft is known
        try {
            const sqft = subjectDetails?.sqft;
            if (Number.isFinite(sqft) && sqft > 0 && analysis.qualified_comps.length > 0) {
                console.log('\n💰 ARV FROM COMPREHENSIVE COMPS');
                console.log('------------------------------------------------------------');
                const renovatedOnly = (analysis.renovation_analysis?.likely_renovated || [])
                    .filter((c) => Number.isFinite(Number(c?.price)) && Number.isFinite(Number(c?.sqft)) && Number(c?.sqft) > 0);
                let compsForArv = renovatedOnly;
                if (renovatedOnly.length < 3) {
                    const fallbackAll = analysis.qualified_comps.filter((c) => Number.isFinite(Number(c?.price)) && Number.isFinite(Number(c?.sqft)) && Number(c?.sqft) > 0);
                    console.log(`   ℹ️  Only ${renovatedOnly.length} renovated comps with valid PPSF — falling back to all qualified (${fallbackAll.length})`);
                    compsForArv = fallbackAll;
                }
                else {
                    console.log(`   🎯 Using renovated-only comps for ARV: ${renovatedOnly.length}`);
                }
                const result = this.arvService.calculateARV(compsForArv, sqft, subjectDetails?.baths ?? null);
                console.log(`   Method: ${result.method}`);
                console.log(`   ARV: $${result.arv.toLocaleString()} (${result.confidence} confidence)`);
                analysis.arv = {
                    method: result.method,
                    estimate: result.arv,
                    confidence: result.confidence,
                    dataPoints: result.dataPoints,
                };
            }
            else {
                console.log('\n💡 Skipping ARV: missing subject sqft or no qualified comps');
            }
        }
        catch (e) {
            console.log(`\n⚠️  ARV calculation failed: ${e?.message || e}`);
        }
        return analysis;
    }
    processSearchResults(searchResult, searchType, allComps, frequency) {
        if (searchResult.success && searchResult.comparables.length > 0) {
            console.log(`   ✅ Found ${searchResult.comparables.length} comps in ${searchType} search`);
            searchResult.comparables.forEach((comp) => {
                const key = comp.address;
                if (!allComps.has(key)) {
                    allComps.set(key, { ...comp, first_found_in: searchType });
                }
                frequency.set(key, (frequency.get(key) || 0) + 1);
            });
        }
        else {
            console.log(`   ❌ No comps found in ${searchType} search`);
        }
    }
    analyzeComprehensiveResults(allComps, frequency) {
        console.log('');
        console.log('📊 COMPREHENSIVE ANALYSIS RESULTS');
        console.log('============================================================');
        const allCompsArray = Array.from(allComps.values());
        // Filter by consistency (appeared 1+ times - using best comps from any single search)
        const qualifiedComps = allCompsArray.filter(comp => frequency.get(comp.address) >= 1);
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
    categorizePropsByRenovationStatus(comps) {
        if (comps.length === 0) {
            console.log(`   ❌ No comps for renovation analysis`);
            return { likely_renovated: [], likely_unrenovated: [], market_average: [] };
        }
        const items = comps.map((c) => ({ c, ppsf: Number(c.price) / Number(c.sqft) }))
            .filter((x) => Number.isFinite(x.ppsf));
        if (items.length === 0)
            return { likely_renovated: [], likely_unrenovated: [], market_average: [] };
        const sorted = [...items].sort((a, b) => a.ppsf - b.ppsf);
        const mid = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 ? sorted[mid].ppsf : (sorted[mid - 1].ppsf + sorted[mid].ppsf) / 2;
        const basePct = parseFloat(process.env.RENOVATED_BAND_PCT || '0.075');
        const maxPct = parseFloat(process.env.RENOVATED_BAND_MAX || '0.15');
        const minCount = parseInt(process.env.RENOVATED_MIN_COUNT || '3', 10);
        let pct = basePct;
        let renovated = [];
        while (true) {
            const lo = median * (1 - pct);
            const hi = median * (1 + pct);
            renovated = items.filter((x) => x.ppsf >= lo && x.ppsf <= hi).map((x) => x.c);
            console.log(`   🎯 Renovated band: median=$${median.toFixed(2)} ± ${(pct * 100).toFixed(1)}% → [${lo.toFixed(2)}, ${hi.toFixed(2)}], count=${renovated.length}`);
            if (renovated.length >= minCount || pct >= maxPct)
                break;
            pct = Math.min(maxPct, pct + 0.025);
        }
        if (renovated.length < Math.min(minCount, items.length)) {
            const need = Math.min(minCount, items.length) - renovated.length;
            const set = new Set(renovated.map((c) => c.address));
            const nearest = items
                .filter((x) => !set.has(x.c.address))
                .sort((a, b) => Math.abs(a.ppsf - median) - Math.abs(b.ppsf - median))
                .slice(0, need)
                .map((x) => x.c);
            renovated = renovated.concat(nearest);
            console.log(`   ➕ Added ${nearest.length} nearest-to-median to reach minimum ${minCount}`);
        }
        const rset = new Set(renovated.map((c) => c.address));
        const likely_unrenovated = comps.filter((c) => !rset.has(c.address));
        const market_average = [];
        console.log(`   🔧 Renovated (band) comps:`);
        renovated.slice(0, 6).forEach((c) => { const p = c.price / c.sqft; console.log(`      ${c.address} - $${p.toFixed(2)} PPSF`); });
        return { likely_renovated: renovated, likely_unrenovated, market_average };
    }
}
