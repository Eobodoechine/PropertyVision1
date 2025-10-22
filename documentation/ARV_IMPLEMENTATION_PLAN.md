# ARV Calculator - Final Implementation Plan (95% → 100%)

**Status**: Core algorithm correct. Final tweaks needed for deterministic, audit-friendly behavior.

---

## ✅ What's Already Correct (Keep)

- Overall flow: Clean → Low-tail drop → HighCluster → CentralUpperChain → Isolation guard → ARV
- HighCluster: top-half floor, stop at global largest gap, ≥3 confirmed via two closest prices
- CentralUpperChain: start upper middle, walk upward only, stop at first gap ≥ largest below
- ARV = median PPSF × subject sqft
- Aggressive = HighCluster; Conservative = CentralUpperChain (or HighCluster if no chain)
- Reason codes & thin-market handling

---

## 🛠 Final Tweaks Needed

### 1. Price Isolation Guard - Add `wouldStillHave2OrMore` Logic

**Location**: Line 388-446 in arvCalculator.js

```javascript
applyPriceIsolationGuard(chainResult, allComps) {
  const { kept, dropped } = chainResult;
  if (kept.length <= 2) return chainResult;

  const finalKept = [];
  const additionalDropped = [];
  const keptSet = new Set(kept.map(c => c.id));

  for (const comp of kept) {
    // Find TWO closest prices among ALL comps (not just kept)
    const closestTwo = allComps
      .filter(c => c.id !== comp.id)
      .map(c => ({ id: c.id, price: c.price, diff: Math.abs(c.price - comp.price) }))
      .sort((a, b) => a.diff - b.diff)
      .slice(0, 2);

    // Both must be in kept set
    const bothInKept = closestTwo.every(c => keptSet.has(c.id));

    if (bothInKept) {
      finalKept.push(comp);
    } else {
      // Only drop if we'd still have ≥2 comps
      const wouldStillHave2OrMore = (kept.length - additionalDropped.length - 1) >= 2;
      if (wouldStillHave2OrMore) {
        additionalDropped.push({ id: comp.id, reason_codes: ['high_price_isolated'] });
      } else {
        finalKept.push(comp);
        console.log(`${comp.id} kept despite isolation (thin market protection)`);
      }
    }
  }

  return {
    kept: finalKept,
    dropped: [...dropped, ...additionalDropped],
    thin: finalKept.length < 3
  };
}
```

**Update call site** (Line 52):
```javascript
const finalResult = this.applyPriceIsolationGuard(chainResult, afterLowFilter);
```

---

### 2. Deduplication - Normalize Address (No Geocoding)

**Location**: Line 90-132 in arvCalculator.js

```javascript
normalizeAddress(comp) {
  // Parse address into components
  const address = comp.address || '';
  const match = address.match(/^(\d+)\s+(.+?),\s*([^,]+),\s*([A-Z]{2})\s*(\d{5})/);

  if (!match) {
    // Fall back to raw address if parsing fails
    return {
      key: address.toLowerCase().trim(),
      zip: '',
      unit: comp.unit || ''
    };
  }

  const [, number, street, city, state, zip] = match;

  // Canonicalize street: N→North, St→Street, Dr→Drive, etc.
  const canonicalStreet = street
    .replace(/\bN\b/gi, 'North')
    .replace(/\bS\b/gi, 'South')
    .replace(/\bE\b/gi, 'East')
    .replace(/\bW\b/gi, 'West')
    .replace(/\bSt\b/gi, 'Street')
    .replace(/\bDr\b/gi, 'Drive')
    .replace(/\bAve\b/gi, 'Avenue')
    .replace(/\bRd\b/gi, 'Road')
    .replace(/\bBlvd\b/gi, 'Boulevard')
    .replace(/\bLn\b/gi, 'Lane')
    .replace(/\bCt\b/gi, 'Court')
    .replace(/\bCir\b/gi, 'Circle')
    .replace(/\s+/g, ' ')
    .trim();

  const unit = comp.unit || '';
  const normalizedLine1 = `${number} ${canonicalStreet}`;

  return {
    key: `${normalizedLine1}|${zip}|${unit}`.toLowerCase(),
    zip,
    unit,
    normalizedLine1
  };
}

// In cleanAndPrepare():
const normalized = cleaned.map(comp => ({
  ...comp,
  ...this.normalizeAddress(comp)
}));

// Deduplicate using key
const addressMap = new Map();
for (const comp of normalized) {
  if (!addressMap.has(comp.key)) {
    addressMap.set(comp.key, comp);
  } else {
    // Keep more recent
    const existing = addressMap.get(comp.key);
    if (new Date(comp.saleDate) > new Date(existing.saleDate)) {
      addressMap.set(comp.key, comp);
    }
  }
}
```

**Edge case**: Missing ZIP
```javascript
if (!zip) {
  // Fall back to {line1|unit} + require price & sqft match
  if (existing.price === comp.price && existing.sqft === comp.sqft) {
    // Likely duplicate
    keep most recent;
  } else {
    // Keep both, mark possible_duplicate
    comp.flags = [...(comp.flags || []), 'possible_duplicate'];
  }
}
```

---

### 3. HighCluster - Enforce Contiguous Block

**Location**: Line 256-272 in arvCalculator.js

```javascript
// Build top block from highest PPSF downward
const block = [];
for (let i = n - 1; i >= 0; i--) {
  // Stop at floor
  if (sortedAsc[i].ppsf < ppsfFloor) {
    break;
  }

  // Stop at global largest gap (ensures contiguous above gap)
  if (i - 1 >= 0 && gaps[i - 1] >= globalLargestGap) {
    break;
  }

  block.push(i);
}

// Block must be contiguous (sequential indices)
block.sort((a, b) => a - b);
const isContiguous = block.every((idx, pos) => pos === 0 || idx === block[pos - 1] + 1);

if (!isContiguous || block.length < 3) {
  return { success: false };
}
```

---

### 4. CentralUpperChain - Add Two-Comp Rescue

**Location**: After line 367 in arvCalculator.js

```javascript
// After building chain
if (keptIdx.length === 1) {
  console.log('   Chain length = 1, applying two-comp rescue');

  // Find tightest adjacent pair
  let minGap = Infinity;
  let bestPair = null;

  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1].ppsf - sorted[i].ppsf;
    if (gap < minGap || (gap === minGap && bestPair && i > bestPair[0])) {
      minGap = gap;
      bestPair = [i, i + 1];
    }
  }

  const rescued = bestPair.map(i => ({ ...sorted[i], reason: 'two_comp_rescue' }));
  const droppedRescue = sorted
    .filter((_, i) => !bestPair.includes(i))
    .map(c => ({ id: c.id, reason_codes: ['isolated_high_endpoint'] }));

  return {
    kept: rescued,
    dropped: droppedRescue,
    thin: true
  };
}
```

---

### 5. Three-Comps Mode - Remove Hidden Percentage

**Location**: Line 199-228 in arvCalculator.js

```javascript
handleThreeComps(comps, subjectSqft) {
  console.log('\n🔥 SPECIAL: 3-COMP MODE');

  const sorted = [...comps].sort((a, b) => a.ppsf - b.ppsf);
  const [c1, c2, c3] = sorted;

  const g1 = c2.ppsf - c1.ppsf;
  const g2 = c3.ppsf - c2.ppsf;

  console.log(`   Gaps: g1=${g1.toFixed(2)}, g2=${g2.toFixed(2)}`);

  // If first gap is largest → drop low
  if (g1 > g2) {
    console.log('   First gap larger → drop low, keep {mid, high}');
    return this.formatResult('ThreeComps', {
      kept: [{ ...c2, reason: 'three_comp_mid' }, { ...c3, reason: 'three_comp_high' }],
      dropped: [{ id: c1.id, reason_codes: ['low_ppsf_isolated'] }],
      thin: true
    }, subjectSqft);
  }

  // Otherwise keep tighter pair (tie → upper pair)
  if (g2 > g1) {
    console.log('   Second gap larger → keep {low, mid}');
    return this.formatResult('ThreeComps', {
      kept: [{ ...c1, reason: 'three_comp_lower' }, { ...c2, reason: 'three_comp_mid' }],
      dropped: [{ id: c3.id, reason_codes: ['high_price_isolated'] }],
      thin: true
    }, subjectSqft);
  }

  // Tie → upper pair
  console.log('   Gaps equal → keep {mid, high}');
  return this.formatResult('ThreeComps', {
    kept: [{ ...c2, reason: 'three_comp_mid' }, { ...c3, reason: 'three_comp_high' }],
    dropped: [{ id: c1.id, reason_codes: ['low_ppsf_isolated'] }],
    thin: true
  }, subjectSqft);
}
```

---

### 6. Flat-PPSF Mode - Derive Epsilon Without Percent

**Location**: After cleaning in calculateARV()

```javascript
// Check for flat PPSF (all gaps effectively zero)
if (cleaned.length >= 2) {
  const sorted = [...cleaned].sort((a, b) => a.ppsf - b.ppsf);
  const gaps = Array.from({length: sorted.length - 1}, (_, i) =>
    sorted[i + 1].ppsf - sorted[i].ppsf
  );

  const maxGap = Math.max(...gaps);
  const minNonZeroGap = Math.min(...gaps.filter(g => g > 0));
  const epsilon = minNonZeroGap || 0.01;

  if (maxGap <= epsilon) {
    console.log('   Flat PPSF mode detected (maxGap ≤ epsilon)');

    // Keep top two prices that are neighbors in PPSF order
    const byPrice = [...sorted].sort((a, b) => b.price - a.price);
    const top2 = byPrice.slice(0, 2);

    const indices = top2.map(c => sorted.indexOf(c)).sort((a, b) => a - b);

    if (indices[1] - indices[0] === 1) {
      return this.formatResult('FlatPPSF', {
        kept: indices.map(i => ({ ...sorted[i], reason: 'flat_ppsf_top_price' })),
        dropped: sorted.filter((_, i) => !indices.includes(i))
          .map(c => ({ id: c.id, reason_codes: ['flat_ppsf_lower_price'] })),
        thin: true
      }, subject.sqft);
    }
  }
}
```

---

### 7. Lower-Side Max Gap Edge Case (mid === 0)

**Location**: Line 345-348 in arvCalculator.js

```javascript
// Max gap in the lower side (strictly below mid)
const lowerMaxGap = (mid >= 1) ? Math.max(...gaps.slice(0, mid)) : Math.max(...gaps);
console.log(`   lowerMaxGap = ${lowerMaxGap.toFixed(2)}`);
```

**Rationale**: When mid === 0 (e.g., 2 comps), no lower gaps exist. Use global max gap as stop comparator.

---

### 8. Aggressive vs Conservative - Final Mapping

**Location**: Return statement in calculateARV()

```javascript
// After HighCluster and CentralUpperChain logic:
return {
  method_used: finalMethod, // 'HighCluster', 'CentralUpperChain', 'ThreeComps', etc.
  kept_comps: finalKept,
  dropped_comps: finalDropped,

  // Conservative = CentralUpperChain (if exists), else HighCluster
  conservative: centralUpperChainResult || highClusterResult,

  // Aggressive = HighCluster (if exists), else CentralUpperChain
  aggressive: highClusterResult || centralUpperChainResult,

  flags: {
    thin_market: thin,
    no_high_cluster: !highClusterSucceeded
  }
};
```

---

### 9. Always Populate reason_codes

**Every drop must include reason_codes array**:

```javascript
// Examples:
{ id: 'C1', reason_codes: ['dup_address_unit'] }
{ id: 'C2', reason_codes: ['low_ppsf_isolated'] }
{ id: 'C3', reason_codes: ['outside_chain'] }
{ id: 'C4', reason_codes: ['high_no_support'] }
{ id: 'C5', reason_codes: ['high_price_isolated'] }
{ id: 'C6', reason_codes: ['isolated_high_endpoint'] }
{ id: 'C7', reason_codes: ['possible_duplicate'] }
{ id: 'C8', reason_codes: ['flat_ppsf_lower_price'] }
```

---

## 🧪 Test Matrix

| Scenario | Expected Behavior |
|----------|------------------|
| **Top cluster (≥3)** | HighCluster returns contiguous block above floor, ≥3 confirmed via two-closest-prices |
| **Isolated top sale** | HighCluster fails → CentralUpperChain keeps tight upper band (2-3 comps) |
| **Chain === 1** | Two-comp rescue picks tightest adjacent pair (tie → upper), thin_market = true |
| **Three comps** | Use gap rule (no percents), upper tie-break |
| **Flat PPSF** | Keep top 2 by price that are neighbors in PPSF order, thin_market = true |
| **Duplicate (city drift)** | "East Point" vs "Atlanta" with same line1+ZIP+unit → one dropped as dup_address_unit |

---

## Summary

**Current**: 95% aligned
**After these tweaks**: 100% - deterministic, auditable, no hidden percentages

**Key principle**: All decisions based on absolute gap comparisons, two-closest-prices logic (absolute difference), index positions, and contiguity. **Zero percentage thresholds.**
