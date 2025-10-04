// Complete ARV Calculator - Implements the full valuation methodology
// Combines your original description with the strict CentralUpperChain algorithm

export class ARVCalculator {

  /**
   * Main ARV calculation entry point
   */
  calculateARV(subject, comparables) {
    console.log(`🧮 CALCULATING ARV FOR ${subject.sqft} SQFT PROPERTY`);
    console.log(`📊 Input: ${comparables.length} comparables`);

    try {
      // Step 0: Clean & prepare
      const cleaned = this.cleanAndPrepare(comparables);
      console.log(`📊 After cleaning: ${cleaned.length} comparables`);

      if (cleaned.length < 2) {
        return this.insufficientDataResult(cleaned, "Less than 2 valid comparables");
      }

      // Special case: 3 comps
      if (cleaned.length === 3) {
        return this.handleThreeComps(cleaned, subject.sqft);
      }

      // Step 1: Remove isolated lows using largest gap analysis
      const afterLowFilter = this.removeObviousLows(cleaned);
      console.log(`📊 After low filter: ${afterLowFilter.length} comparables`);

      if (afterLowFilter.length < 2) {
        return this.insufficientDataResult(afterLowFilter, "Less than 2 comps after filtering lows");
      }

      // Step 2: Try to form a supported high cluster (HighCluster)
      const highClusterResult = this.tryHighCluster(afterLowFilter);

      if (highClusterResult.success) {
        console.log(`📊 HighCluster found: ${highClusterResult.kept.length} comps`);
        return this.formatResult('HighCluster', highClusterResult, subject.sqft);
      }

      // Step 3: Build CentralUpperChain (fallback)
      console.log(`📊 No HighCluster found, using CentralUpperChain`);
      const chainResult = this.buildCentralUpperChain(afterLowFilter);

      if (chainResult.kept.length < 2) {
        return this.insufficientDataResult(chainResult.kept, "CentralUpperChain produced less than 2 comps");
      }

      // Step 4: Price isolation guard
      const finalResult = this.applyPriceIsolationGuard(chainResult);

      return this.formatResult('CentralUpperChain', finalResult, subject.sqft);

    } catch (error) {
      console.error('ARV Calculation Error:', error);
      return this.insufficientDataResult([], `Error: ${error.message}`);
    }
  }

  /**
   * Step 0: Clean and prepare data
   */
  cleanAndPrepare(comparables) {
    console.log('\n🧹 STEP 0: CLEAN & PREPARE');

    // Filter valid comps (price > 0, sqft > 0)
    let cleaned = comparables.filter(comp => {
      const price = comp.price || comp.comp?.price || 0;
      const sqft = comp.sqft || comp.comp?.sqft || 0;
      return price > 0 && sqft > 0;
    });

    console.log(`   Valid comps: ${cleaned.length}`);

    // Calculate PPSF and normalize data
    cleaned = cleaned.map((comp, index) => ({
      id: comp.id || `C${index + 1}`,
      address: comp.address || comp.comp?.address || 'Unknown Address',
      price: comp.price || comp.comp?.price,
      sqft: comp.sqft || comp.comp?.sqft,
      ppsf: (comp.price || comp.comp?.price) / (comp.sqft || comp.comp?.sqft),
      saleDate: comp.saleDate || comp.comp?.saleDate || comp.sale_date || '2025-01-01',
      lat: comp.lat || comp.comp?.lat,
      lng: comp.lng || comp.comp?.lng,
      reason: 'included'
    }));

    // Remove duplicates by address (keep most recent)
    const deduped = [];
    const addressMap = new Map();

    for (const comp of cleaned) {
      // Use coordinates for deduplication if available, otherwise fall back to address
      let key;
      if (comp.lat && comp.lng) {
        // Round to 6 decimal places (~1 meter precision) for coordinate matching
        key = `${Math.round(comp.lat * 1000000)},${Math.round(comp.lng * 1000000)}`;
        console.log(`   Comp ${comp.id}: coordinates key = ${key}`);
      } else {
        key = comp.address.toLowerCase().trim();
        console.log(`   Comp ${comp.id}: address key = ${key}`);
      }

      if (!addressMap.has(key)) {
        addressMap.set(key, comp);
        deduped.push(comp);
        console.log(`   Added ${comp.id} with key ${key}`);
      } else {
        // Keep more recent sale
        const existing = addressMap.get(key);
        console.log(`   Found duplicate: ${comp.id} matches existing ${existing.id} (key: ${key})`);
        if (new Date(comp.saleDate) > new Date(existing.saleDate)) {
          const index = deduped.findIndex(c => {
            let cKey;
            if (c.lat && c.lng) {
              cKey = `${Math.round(c.lat * 1000000)},${Math.round(c.lng * 1000000)}`;
            } else {
              cKey = c.address.toLowerCase().trim();
            }
            return cKey === key;
          });
          if (index !== -1) {
            deduped[index] = comp;
            addressMap.set(key, comp);
            console.log(`   Replaced ${existing.id} with ${comp.id} (newer date)`);
          }
        }
        console.log(`   Duplicate removed: ${comp.address} (same coordinates: ${key})`);
      }
    }

    console.log(`   After dedup: ${deduped.length} comps`);

    // Show cleaned data
    deduped.forEach((comp, i) => {
      console.log(`   ${i+1}. ${comp.address} - $${comp.ppsf.toFixed(2)}/sqft`);
    });

    return deduped;
  }

  /**
   * Helper: Get upper middle index for top-half floor
   */
  upperMiddleIndex(n) {
    return (n % 2 === 0) ? n / 2 : Math.floor(n / 2);
  }

  /**
   * Step 1: Remove obvious lows using largest gap analysis
   */
  removeObviousLows(comps) {
    console.log('\n📉 STEP 1: REMOVE OBVIOUS LOWS');

    if (comps.length < 4) {
      console.log('   Insufficient comps for low removal (need ≥4)');
      return comps;
    }

    // Sort by PPSF
    const sorted = [...comps].sort((a, b) => a.ppsf - b.ppsf);
    console.log('   Sorted by PPSF:');
    sorted.forEach((comp, i) => {
      console.log(`   ${i}: ${comp.address} - $${comp.ppsf.toFixed(2)}/sqft`);
    });

    // Calculate adjacent gaps
    const gaps = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      gaps.push(sorted[i + 1].ppsf - sorted[i].ppsf);
    }
    console.log(`   Gaps: [${gaps.map(g => g.toFixed(2)).join(', ')}]`);

    // Find largest gap
    const maxGapValue = Math.max(...gaps);
    const maxGapIndex = gaps.indexOf(maxGapValue);
    console.log(`   Largest gap: ${maxGapValue.toFixed(2)} at index ${maxGapIndex}`);

    // If first gap is largest, remove lowest
    if (maxGapIndex === 0) {
      console.log(`   Removing isolated low: ${sorted[0].address}`);
      const filtered = sorted.slice(1);

      // Check again after removal
      if (filtered.length >= 4) {
        return this.removeObviousLows(filtered);
      }
      return filtered;
    }

    return sorted;
  }

  /**
   * Special handling for 3-comp case
   */
  handleThreeComps(comps, subjectSqft) {
    console.log('\n🔥 SPECIAL: 3-COMP MODE');

    const sorted = [...comps].sort((a, b) => a.ppsf - b.ppsf);
    const [c1, c2, c3] = sorted;
    const g1 = c2.ppsf - c1.ppsf;
    const g2 = c3.ppsf - c2.ppsf;

    console.log(`   Sorted: ${c1.id}($${c1.ppsf.toFixed(2)}), ${c2.id}($${c2.ppsf.toFixed(2)}), ${c3.id}($${c3.ppsf.toFixed(2)})`);
    console.log(`   Gaps: g1=${g1.toFixed(2)}, g2=${g2.toFixed(2)}`);

    // Step 1: obvious low drop
    if (g1 > g2) {
      console.log(`   First gap (${g1.toFixed(2)}) > second gap (${g2.toFixed(2)}) → drop lowest`);
      const pair = [c2, c3];
      pair.forEach(comp => comp.reason = 'tight_pair');
      const dropped = [{ ...c1, reason_codes: ['obvious_low'] }];
      return this.buildResult('CentralUpperChain', pair, dropped, subjectSqft, true);
    }

    // Step 2: choose tighter pair (tie → upper pair)
    const pair = (g2 <= g1) ? [c2, c3] : [c1, c2];
    const droppedComp = (g2 <= g1) ? c1 : c3;

    console.log(`   Using tighter pair: ${pair.map(c => c.id).join(', ')}`);
    pair.forEach(comp => comp.reason = 'tight_pair');
    const dropped = [{ ...droppedComp, reason_codes: ['outside_tight_pair'] }];

    return this.buildResult('CentralUpperChain', pair, dropped, subjectSqft, true);
  }

  /**
   * Step 2: Try to form a supported high cluster with improved guardrails
   */
  tryHighCluster(comps) {
    console.log('\n📈 STEP 2: TRY HIGHCLUSTER (IMPROVED)');

    if (comps.length < 3) {
      console.log('   Insufficient comps for HighCluster');
      return { success: false };
    }

    // Sort by PPSF ascending for consistent indexing
    const sortedAsc = [...comps].sort((a, b) => a.ppsf - b.ppsf);
    const n = sortedAsc.length;

    // (A) Top-half floor: upper-middle PPSF
    const floorIdx = this.upperMiddleIndex(n);
    const ppsfFloor = sortedAsc[floorIdx].ppsf;
    console.log(`   (A) Top-half floor: index ${floorIdx}, PPSF >= $${ppsfFloor.toFixed(2)}`);

    // Calculate all gaps
    const gaps = Array.from({length: n-1}, (_, i) => sortedAsc[i+1].ppsf - sortedAsc[i].ppsf);
    const globalLargestGap = Math.max(...gaps);
    console.log(`   All gaps: [${gaps.map(g => g.toFixed(2)).join(', ')}]`);
    console.log(`   (B) Global largest gap: ${globalLargestGap.toFixed(2)}`);

    // Build top block from highest PPSF downward
    const block = [];
    for (let i = n - 1; i >= 0; i--) {
      if (sortedAsc[i].ppsf < ppsfFloor) {
        console.log(`   Stopped at top-half floor: ${sortedAsc[i].id} ($${sortedAsc[i].ppsf.toFixed(2)}) < floor ($${ppsfFloor.toFixed(2)})`);
        break;
      }

      block.push(i);
      console.log(`   Added to block: ${sortedAsc[i].id} ($${sortedAsc[i].ppsf.toFixed(2)})`);

      // (B) Stop at global largest gap
      if (i - 1 >= 0 && gaps[i - 1] >= globalLargestGap) {
        console.log(`   Stopped at largest gap: gaps[${i-1}]=${gaps[i-1].toFixed(2)} >= ${globalLargestGap.toFixed(2)}`);
        break;
      }
    }

    block.sort((a, b) => a - b); // ascending indices
    console.log(`   Block indices: [${block.join(', ')}], size: ${block.length}`);

    if (block.length < 3) {
      console.log(`   Block too small: ${block.length} comps`);
      return { success: false };
    }

    // (C) Price confirmation within block
    const inBlock = new Set(block);
    const confirmed = block.filter(i => {
      const comp = sortedAsc[i];
      // Find two comps with closest prices
      const others = sortedAsc.map((c, j) => ({ j, d: Math.abs(c.price - comp.price) }))
        .filter(o => o.j !== i);
      others.sort((a, b) => a.d - b.d);
      const a = others[0]?.j;
      const b = others[1]?.j;

      const confirmed = a != null && b != null && inBlock.has(a) && inBlock.has(b);
      console.log(`   ${comp.id}: closest prices at indices [${a}, ${b}], both in block: ${confirmed}`);
      return confirmed;
    });

    console.log(`   Confirmed: ${confirmed.length} of ${block.length} comps`);

    if (confirmed.length >= 3) {
      console.log(`   ✅ HighCluster formed: ${confirmed.length} confirmed comps`);

      const kept = confirmed.map(i => ({ ...sortedAsc[i], reason: 'high_cluster_supported' }));
      const dropped = comps.filter(comp => !kept.some(k => k.id === comp.id))
        .map(comp => ({ id: comp.id, reason_codes: ['high_no_support'] }));

      return {
        success: true,
        kept: kept,
        dropped: dropped,
        thin: false
      };
    }

    console.log(`   ❌ HighCluster failed: only ${confirmed.length} confirmed`);
    return { success: false };
  }

  /**
   * Step 3: Build CentralUpperChain - EXACT ALGORITHM FROM YOUR SPEC
   */
  buildCentralUpperChain(comps) {
    console.log('\n⚡ STEP 3: CENTRALUPPERCHAIN ALGORITHM');

    // Sort by PPSF ascending
    const sorted = [...comps].sort((a, b) => a.ppsf - b.ppsf);
    const n = sorted.length;

    console.log(`   Sorted PPSF: ${sorted.map(c => `${c.id} ${c.ppsf.toFixed(2)}`).join(', ')}`);
    console.log(`   Step A: n = ${n} comps, indices [${Array.from({length: n}, (_, i) => i).join(',')}]`);

    if (n < 2) {
      return { kept: [], dropped: comps.map(c => ({id: c.id, reason_codes: ['insufficient']})), thin: true };
    }

    // Step B: Find upper middle starting point
    const mid = (n % 2 === 0) ? (n / 2) : Math.floor(n / 2);
    console.log(`   Step B: n=${n} is ${n % 2 === 1 ? 'odd' : 'even'}, so mid = ${mid}`);
    console.log(`   Starting comp: index ${mid} = ${sorted[mid].id} ($${sorted[mid].ppsf.toFixed(2)}/sqft)`);

    // Step C: Calculate adjacent gaps
    const gaps = Array.from({length: n-1}, (_, i) => sorted[i+1].ppsf - sorted[i].ppsf);
    console.log(`   Step C: All gaps = [${gaps.map(g => g.toFixed(2)).join(', ')}]`);

    // Max gap in the lower side (strictly below mid)
    const lowerMaxGap = (mid >= 1) ? Math.max(...gaps.slice(0, mid)) : -Infinity;
    console.log(`   Lower gaps (before mid=${mid}): [${gaps.slice(0, mid).map(g => g.toFixed(2)).join(', ')}]`);
    console.log(`   lowerMaxGap = ${lowerMaxGap === -Infinity ? '-Infinity' : lowerMaxGap.toFixed(2)}`);

    // Step D: Build contiguous upward chain from mid
    console.log(`   Step D: Building chain from mid=${mid}`);
    const keptIdx = [mid];
    console.log(`   - chain = [${mid}] (${sorted[mid].id})`);

    for (let i = mid; i < n - 1; i++) {
      const g = gaps[i];
      console.log(`   - i=${i}: check gaps[${i}]=${g.toFixed(2)} vs lowerMaxGap=${lowerMaxGap === -Infinity ? '-Infinity' : lowerMaxGap.toFixed(2)}`);

      if (g >= lowerMaxGap) {
        console.log(`     Since ${g.toFixed(2)} >= ${lowerMaxGap === -Infinity ? '-Infinity' : lowerMaxGap.toFixed(2)}, STOP (large jump)`);
        break;
      }

      keptIdx.push(i + 1);
      console.log(`     Since ${g.toFixed(2)} < ${lowerMaxGap.toFixed(2)}, ADD index ${i + 1}`);
      console.log(`   - chain = [${keptIdx.join(',')}] (${keptIdx.map(idx => sorted[idx].id).join(', ')})`);
    }

    // Step E: Format results
    const kept = keptIdx.map(i => ({ ...sorted[i], reason: 'central_upper_chain' }));
    const keptIds = new Set(keptIdx);
    const dropped = sorted
      .map((c, i) => keptIds.has(i) ? null : { id: c.id, reason_codes: ['outside_chain'] })
      .filter(Boolean);

    const thin = kept.length < 3;

    console.log(`   Final chain indices: [${keptIdx.join(',')}]`);
    console.log(`   Final chain comps: ${kept.map(c => `${c.id}($${c.ppsf.toFixed(2)})`).join(', ')}`);
    console.log(`   Thin market: ${thin}`);

    return { kept, dropped, thin };
  }

  /**
   * Step 4: Price isolation guard
   */
  applyPriceIsolationGuard(chainResult) {
    console.log('\n🛡️ STEP 4: PRICE ISOLATION GUARD');

    const { kept, dropped } = chainResult;

    if (kept.length <= 2) {
      console.log('   Skipping isolation guard (≤2 comps, thin market protection)');
      return chainResult;
    }

    const finalKept = [];
    const additionalDropped = [];

    for (const comp of kept) {
      // Find two closest prices within the KEPT set only (not all comps)
      const otherKeptPrices = kept.filter(c => c.id !== comp.id).map(c => c.price);

      if (otherKeptPrices.length === 0) {
        // Only 1 comp in kept set, keep it
        finalKept.push(comp);
        console.log(`   ${comp.id} kept (only comp in chain)`);
        continue;
      }

      const closestKeptPrices = otherKeptPrices
        .map(price => ({ price, diff: Math.abs(price - comp.price) }))
        .sort((a, b) => a.diff - b.diff)
        .slice(0, Math.min(2, otherKeptPrices.length))
        .map(p => p.price);

      // Check if the closest comp in the kept set is reasonably close
      // Use 15% threshold - if closest neighbor is >15% away in price, it's isolated
      const closestDiff = Math.abs(comp.price - closestKeptPrices[0]);
      const percentDiff = (closestDiff / comp.price) * 100;

      if (percentDiff < 15) {
        // Not isolated - closest neighbor is within 15%
        finalKept.push(comp);
        console.log(`   ${comp.id} kept (closest neighbor ${percentDiff.toFixed(1)}% away)`);
      } else {
        // Isolated - closest neighbor is >15% away
        // Only drop if we'd still have ≥2 comps after dropping this one
        const wouldHaveAfterDrop = kept.length - additionalDropped.length - 1;
        if (wouldHaveAfterDrop >= 2) {
          additionalDropped.push({ id: comp.id, reason_codes: ['high_price_isolated'] });
          console.log(`   ${comp.id} dropped (price isolated - ${percentDiff.toFixed(1)}% from closest)`);
        } else {
          finalKept.push(comp);
          console.log(`   ${comp.id} kept despite isolation (thin market protection)`);
        }
      }
    }

    return {
      kept: finalKept,
      dropped: [...dropped, ...additionalDropped],
      thin: finalKept.length < 3
    };
  }

  /**
   * Format final result
   */
  formatResult(method, chainResult, subjectSqft) {
    console.log('\n💰 CALCULATING FINAL ARV');

    if (!chainResult || !chainResult.kept) {
      console.error('Invalid chainResult:', chainResult);
      return this.insufficientDataResult([], 'Invalid chain result');
    }

    const { kept, dropped, thin } = chainResult;

    // Calculate median PPSF
    const ppsfValues = kept.map(comp => comp.ppsf).sort((a, b) => a - b);
    console.log(`   PPSF values: [${ppsfValues.map(p => p.toFixed(2)).join(', ')}]`);

    let medianPpsf;
    if (ppsfValues.length % 2 === 1) {
      medianPpsf = ppsfValues[Math.floor(ppsfValues.length / 2)];
      console.log(`   Median (odd count): $${medianPpsf.toFixed(2)}/sqft`);
    } else {
      const mid1 = ppsfValues[ppsfValues.length / 2 - 1];
      const mid2 = ppsfValues[ppsfValues.length / 2];
      medianPpsf = (mid1 + mid2) / 2;
      console.log(`   Median (even count): ($${mid1.toFixed(2)} + $${mid2.toFixed(2)}) / 2 = $${medianPpsf.toFixed(2)}/sqft`);
    }

    const arvPrice = Math.round(medianPpsf * subjectSqft);
    console.log(`   ARV = $${medianPpsf.toFixed(2)}/sqft × ${subjectSqft} sqft = $${arvPrice.toLocaleString()}`);

    const conservativeResult = {
      arv_ppsf: medianPpsf,
      arv_price: arvPrice,
      comp_ids: kept.map(comp => comp.id)
    };

    return {
      method_used: method,
      kept_comps: kept.map(comp => ({
        id: comp.id,
        address: comp.address,
        price: comp.price,
        sqft: comp.sqft,
        ppsf: comp.ppsf,
        reason: comp.reason
      })),
      dropped_comps: dropped,
      conservative: conservativeResult,
      aggressive: method === 'HighCluster' ? conservativeResult : {
        ...conservativeResult,
        no_high_cluster: true
      },
      flags: {
        thin_market: thin,
        mixed_types: false
      },
      notes: `Applied ${method} methodology. ${kept.length} comps used for ARV calculation.`
    };
  }

  /**
   * Handle insufficient data cases
   */
  insufficientDataResult(comps, reason) {
    return {
      method_used: 'insufficient_data',
      kept_comps: [],
      dropped_comps: comps.map(comp => ({
        id: comp.id || 'unknown',
        reason_codes: ['insufficient_data']
      })),
      conservative: {
        arv_ppsf: 0,
        arv_price: 0,
        comp_ids: []
      },
      aggressive: {
        arv_ppsf: 0,
        arv_price: 0,
        comp_ids: [],
        no_high_cluster: true
      },
      flags: {
        thin_market: true,
        mixed_types: false
      },
      notes: `Insufficient data: ${reason}`
    };
  }
}