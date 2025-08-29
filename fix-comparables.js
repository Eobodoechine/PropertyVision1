const fs = require('fs');
const path = require('path');

const target = path.join(process.cwd(), 'PropertyVision1/server/storage.ts');
if (!fs.existsSync(target)) {
  console.error('❌ Could not find:', target);
  process.exit(1);
}

const src = fs.readFileSync(target, 'utf8');
const backup = target + '.bak';
fs.writeFileSync(backup, src);
let out = src;

// Helper to replace and log
function patch(desc, re, replacement) {
  const before = out;
  out = out.replace(re, replacement);
  if (out !== before) {
    console.log('✓', desc);
  } else {
    console.log('• (no change)', desc);
  }
}

// 1) Use real IDs instead of "comp-#"
patch(
  'Use real comp id (listing_id/property_id) instead of comp-#',
  /id:\s*`comp-\$\{index \+ 1\}`/g,
  "id: String(comp?.id ?? comp?.listing_id ?? comp?.property_id ?? `comp-${index + 1}`)"
);

// 2) Safe price formatting (avoid comp.price.toLocaleString crash)
patch(
  'Safe price formatting',
  /price:\s*`\$\$\{comp\.price\.toLocaleString\(\)\}`/g,
  "price: (comp?.price != null ? ('$' + Number(comp.price).toLocaleString()) : '')"
);

// 3) Safe pricePerSqft formatting
patch(
  'Safe pricePerSqft formatting',
  /pricePerSqft:\s*`\$\$\{comp\.pricePerSqft\}`/g,
  "pricePerSqft: (comp?.pricePerSqft != null ? ('$' + Number(comp.pricePerSqft).toLocaleString()) : '')"
);

// 4) Use real distance when present
patch(
  'Use real distance_miles when present',
  /distance:\s*'1\.0 miles'/g,
  "distance: (comp?.distance_miles != null ? `${Number(comp.distance_miles).toFixed(1)} miles` : '')"
);

// 5) Normalize numeric fields (beds/baths/sqft)
patch(
  'Normalize beds',
  /beds:\s*comp\.beds\s*\|\|\s*0/g,
  "beds: Number(comp?.beds ?? 0)"
);
patch(
  'Normalize baths',
  /baths:\s*comp\.baths\s*\|\|\s*0/g,
  "baths: Number(comp?.baths ?? 0)"
);
patch(
  'Normalize sqft',
  /sqft:\s*comp\.sqft\s*\|\|\s*0/g,
  "sqft: Number(comp?.sqft ?? 0)"
);

// 6) soldDate fallback chain
patch(
  'Use soldDate/close_date/list_date fallback',
  /soldDate:\s*comp\.soldDate/g,
  "soldDate: (comp?.soldDate ?? comp?.close_date ?? comp?.list_date ?? '')"
);

// 7) Apply the same fixes inside the 2-bath comparables block
patch(
  '2-bath block: id',
  /id:\s*`2bath-comp-\$\{index \+ 1\}`/g,
  "id: String(comp?.id ?? comp?.listing_id ?? comp?.property_id ?? `2bath-comp-${index + 1}`)"
);
patch(
  '2-bath block: price',
  /return\s*{\s*[\s\S]*?id:\s*String\(comp\?\..*?\)[\s\S]*?address:\s*`.*?`[\s\S]*?price:\s*`\$\$\{comp\.price\.toLocaleString\(\)\}`/m,
  (m) => m.replace(/price:\s*`\$\$\{comp\.price\.toLocaleString\(\)\}`/, "price: (comp?.price != null ? ('$' + Number(comp.price).toLocaleString()) : '')")
);
patch(
  '2-bath block: beds',
  /beds:\s*comp\.beds\s*\|\|\s*0/g,
  "beds: Number(comp?.beds ?? 0)"
);
patch(
  '2-bath block: baths',
  /baths:\s*comp\.baths\s*\|\|\s*0/g,
  "baths: Number(comp?.baths ?? 0)"
);
patch(
  '2-bath block: sqft',
  /sqft:\s*comp\.sqft\s*\|\|\s*0/g,
  "sqft: Number(comp?.sqft ?? 0)"
);
patch(
  '2-bath block: distance',
  /distance:\s*'1\.0 miles'/g,
  "distance: (comp?.distance_miles != null ? `${Number(comp.distance_miles).toFixed(1)} miles` : '')"
);
patch(
  '2-bath block: pricePerSqft',
  /pricePerSqft:\s*`\$\$\{comp\.pricePerSqft\}`/g,
  "pricePerSqft: (comp?.pricePerSqft != null ? ('$' + Number(comp.pricePerSqft).toLocaleString()) : '')"
);
patch(
  '2-bath block: soldDate',
  /soldDate:\s*comp\.soldDate/g,
  "soldDate: (comp?.soldDate ?? comp?.close_date ?? comp?.list_date ?? '')"
);

if (out !== src) {
  fs.writeFileSync(target, out);
  console.log('✅ Patched', target);
  console.log('   • Backup:', backup);
} else {
  console.log('ℹ️ No changes written (file already patched?)');
}
