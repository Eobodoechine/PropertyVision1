// ARV Calculation Debug Test
// Testing with actual data from 3690 Herren Dr SW Smyrna, GA 30082

import { ARVCalculator } from './src/server/arvCalculator.js';

const calculator = new ARVCalculator();

// Subject property
const subject = {
  address: "3690 Herren Dr SW Smyrna, GA 30082",
  sqft: 1500
};

// Actual comps from the test (8 total)
const comps = [
  { address: "3665 Herren Dr SW, Smyrna, GA 30082", price: 379000, sqft: 1513 },
  { address: "3650 Rock Springs Dr SW, Smyrna, GA 30082", price: 385000, sqft: 1455 },
  { address: "246 Plantation Rd SW, Smyrna, GA 30082", price: 460000, sqft: 1728 },
  { address: "566 Hurt Rd SW, Smyrna, GA 30082", price: 352000, sqft: 1740 },
  { address: "395 Plantation Rd SW, Smyrna, GA 30082", price: 310000, sqft: 1400 },
  { address: "3702 Herren Dr SW, Smyrna, GA 30082", price: 428600, sqft: 1600 },
  { address: "3576 Mill Creek Dr SW, Smyrna, GA 30082", price: 385000, sqft: 1460 },
  { address: "710 Montclair Dr, Smyrna, GA 30082", price: 354000, sqft: 1680 }
];

console.log('\n=== ARV CALCULATION DEBUG TEST ===\n');
console.log(`Subject: ${subject.address}`);
console.log(`Subject SQFT: ${subject.sqft}`);
console.log(`Total Comps: ${comps.length}\n`);

// Calculate PPSF for each comp manually
console.log('Comps with PPSF:');
comps.forEach((comp, i) => {
  const ppsf = (comp.price / comp.sqft).toFixed(2);
  console.log(`  ${i + 1}. ${comp.address.substring(0, 30).padEnd(30)} | $${comp.price.toLocaleString().padStart(8)} | ${comp.sqft} sqft | $${ppsf}/sqft`);
});

console.log('\n--- Running ARV Calculator ---\n');

// Run the calculation
const result = calculator.calculateARV(subject, comps);

console.log('\n=== RESULT ===');
console.log('Method:', result.method_used);
console.log('Conservative ARV:', result.conservative ? `$${result.conservative.arv_price.toLocaleString()}` : 'N/A');
console.log('Comps Used:', result.kept_comps?.length || 0);

if (result.kept_comps && result.kept_comps.length > 0) {
  console.log('\nKept Comps:');
  result.kept_comps.forEach(comp => {
    console.log(`  - ${comp.address} | $${comp.price.toLocaleString()} | ${comp.sqft} sqft | $${comp.ppsf.toFixed(2)}/sqft`);
  });
}

if (result.dropped_comps && result.dropped_comps.length > 0) {
  console.log('\nDropped Comps:');
  result.dropped_comps.forEach(drop => {
    console.log(`  - ${drop.id} | Reason: ${drop.reason_codes?.join(', ') || 'unknown'}`);
  });
}
