// Test script for comparing old vs new ARV algorithm
// Using real data from job 813d039f (staging)

import { ARVCalculator } from './src/server/arvCalculator.js';

console.log('═══════════════════════════════════════════════════════════');
console.log('  ARV Algorithm Test - Job 813d039f Data');
console.log('═══════════════════════════════════════════════════════════\n');

// Subject property from job 813d039f
const subject = {
  address: '2835 Tyler Dwayne Ct, Snellville, GA 30078',
  sqft: 2500,
  beds: 4,
  baths: 2.5,
  yearBuilt: 2004
};

// 4 comps from job 813d039f (extracted from logs)
// These are the actual comps used in the staging test
const comparables = [
  {
    id: 'C1',
    address: '3082 Newtons Crest Cir, Snellville, GA 30078',
    price: 369500,
    sqft: 2500,
    ppsf: 147.81, // $369,500 / 2,500
    saleDate: '2024-01-15'
  },
  {
    id: 'C2',
    address: '2826 Tyler Dewayne Ct, Snellville, GA 30078',
    price: 371700,
    sqft: 2500,
    ppsf: 148.68, // $371,700 / 2,500
    saleDate: '2024-02-01'
  },
  {
    id: 'C3',
    address: '3112 Newtons Crest Cir, Snellville, GA 30078',
    price: 379450,
    sqft: 2500,
    ppsf: 151.78, // $379,450 / 2,500
    saleDate: '2024-03-10'
  },
  {
    id: 'C4',
    address: '3402 Newtons Crest Cir, Snellville, GA 30078',
    price: 390275,
    sqft: 2500,
    ppsf: 156.11, // $390,275 / 2,500
    saleDate: '2024-03-20'
  }
];

console.log('📍 Subject Property:');
console.log(`   ${subject.address}`);
console.log(`   ${subject.sqft} sqft, ${subject.beds}BR/${subject.baths}BA, Built ${subject.yearBuilt}\n`);

console.log('📊 Comparables (n=4):');
comparables.forEach((comp, i) => {
  console.log(`   ${i+1}. ${comp.address}`);
  console.log(`      Price: $${comp.price.toLocaleString()}, PPSF: $${comp.ppsf.toFixed(2)}, Sold: ${comp.saleDate}`);
});
console.log('');

console.log('───────────────────────────────────────────────────────────\n');

// Test NEW algorithm
console.log('🆕 NEW ALGORITHM (Log-Gap Banding)\n');
console.log('Expected behavior for n=4:');
console.log('  - Calculate z-scores on log(PPSF) gaps');
console.log('  - Build contiguous bands (z ≤ 1.0)');
console.log('  - Upper-bias: select highest band with price support');
console.log('  - Fallback: upper-half pairs, then triplets\n');

const calculator = new ARVCalculator();
const result = calculator.calculateARV(subject, comparables);

console.log('\n═══════════════════════════════════════════════════════════');
console.log('  RESULTS');
console.log('═══════════════════════════════════════════════════════════\n');

console.log(`Method Used: ${result.method_used}`);
console.log(`ARV: $${result.conservative.arv_price.toLocaleString()}`);
console.log(`PPSF: $${result.conservative.arv_ppsf.toFixed(2)}`);
console.log(`Comps Used: ${result.kept_comps.length} of ${comparables.length}`);
console.log(`Thin Market: ${result.flags.thin_market ? 'Yes' : 'No'}\n');

console.log('Kept Comps:');
result.kept_comps.forEach(comp => {
  console.log(`  ✅ ${comp.id}: ${comp.address}`);
  console.log(`     $${comp.price.toLocaleString()} ($${comp.ppsf.toFixed(2)}/sqft) - Reason: ${comp.reason}`);
});

if (result.dropped_comps.length > 0) {
  console.log('\nDropped Comps:');
  result.dropped_comps.forEach(drop => {
    const original = comparables.find(c => c.id === drop.id);
    if (original) {
      console.log(`  ❌ ${drop.id}: ${original.address}`);
      console.log(`     $${original.price.toLocaleString()} ($${original.ppsf.toFixed(2)}/sqft) - Reason: ${drop.reason_codes.join(', ')}`);
    }
  });
}

console.log('\n───────────────────────────────────────────────────────────\n');

console.log('📊 COMPARISON WITH OLD ALGORITHM RESULT:\n');
console.log('Old Algorithm (CentralUpperChain + Two-Comp Rescue):');
console.log('  Method: CentralUpperChain');
console.log('  ARV: $370,610');
console.log('  PPSF: $148.24');
console.log('  Comps Used: C1 ($147.81) + C2 ($148.68)');
console.log('  Strategy: Started at mid=2 (C3), hit large gap, fell back to tightest pair\n');

console.log('New Algorithm:');
console.log(`  Method: ${result.method_used}`);
console.log(`  ARV: $${result.conservative.arv_price.toLocaleString()}`);
console.log(`  PPSF: $${result.conservative.arv_ppsf.toFixed(2)}`);
console.log(`  Comps Used: ${result.kept_comps.map(c => `${c.id} ($${c.ppsf.toFixed(2)})`).join(' + ')}`);
console.log(`  Strategy: ${result.notes}\n`);

const oldArv = 370610;
const newArv = result.conservative.arv_price;
const difference = newArv - oldArv;
const percentDiff = ((difference / oldArv) * 100).toFixed(2);

console.log('Difference:');
console.log(`  Absolute: ${difference >= 0 ? '+' : ''}$${difference.toLocaleString()}`);
console.log(`  Percentage: ${difference >= 0 ? '+' : ''}${percentDiff}%`);

if (Math.abs(difference) / oldArv <= 0.20) {
  console.log('  ✅ Within 20% tolerance - ACCEPTABLE');
} else {
  console.log('  ⚠️  Outside 20% tolerance - REVIEW NEEDED');
}

console.log('\n═══════════════════════════════════════════════════════════\n');
