#!/usr/bin/env node
/**
 * Patch script to harden comparables formatting in PropertyVision1/server/storage.ts
 * - Replaces risky toLocaleString() calls on possibly-undefined values
 * - Removes hard-coded distance "1.0 miles"
 * - Uses real IDs (listing_id/property_id) when available
 * - Falls back safely without fabricating values
 */
const fs = require('fs');
const path = require('path');

const target = path.resolve(process.cwd(), 'PropertyVision1/server/storage.ts');

if (!fs.existsSync(target)) {
  console.error('❌ Could not find', target);
  process.exit(1);
}

const src = fs.readFileSync(target, 'utf8');
const backup = target + '.bak';
fs.writeFileSync(backup, src, 'utf8');

let out = src;

// 1) Prefer real IDs instead of synthetic comp-1
out = out.replace(/id:\s*`comp-\$\{index \+\s*1\}`\s*,/g,
  "id: (comp?.listing_id || comp?.property_id || `comp-${index + 1}`),"
);

// 2) Remove hard-coded distance and use real miles if available
out = out.replace(/distance:\s*'1\.0 miles'\s*,/g,
  "distance: (typeof comp?.distance_miles === 'number' ? `${comp.distance_miles.toFixed(2)} miles` : ''),"
);

// 3) Safe price formatting for both main and 2-bath blocks
out = out.replace(/price:\s*`\$\$\{comp\.price\.toLocaleString\(\)\}`\s*,/g,
  "price: (comp?.price != null ? `$${Number(comp.price).toLocaleString()}` : ''),"
);
out = out.replace(/price:\s*`\\\$\$\{comp\.price\.toLocaleString\(\)\}`\s*,/g,
  "price: (comp?.price != null ? `$${Number(comp.price).toLocaleString()}` : ''),"
);

// 4) Safe pricePerSqft formatting
out = out.replace(/pricePerSqft:\s*`\\?\$\$\{comp\.pricePerSqft\}`/g,
  "pricePerSqft: (comp?.pricePerSqft != null ? `$${Number(comp.pricePerSqft).toFixed(0)}` : '')"
);

// 5) Safer numeric fields
out = out.replace(/beds:\s*comp\.beds\s*\|\|\s*0\s*,/g,
  "beds: Number(comp?.beds ?? 0),"
);
out = out.replace(/baths:\s*comp\.baths\s*\|\|\s*0\s*,/g,
  "baths: Number(comp?.baths ?? 0),"
);
out = out.replace(/sqft:\s*comp\.sqft\s*\|\|\s*0\s*,/g,
  "sqft: Number(comp?.sqft ?? 0),"
);

// 6) Try multiple date fields for sold date
out = out.replace(/soldDate:\s*comp\.soldDate\s*,/g,
  "soldDate: (comp?.soldDate || comp?.close_date || comp?.list_date || ''),"
);

// 7) Also patch the 2-bath block variants (duplicate patterns)
out = out.replace(/id:\s*`2bath-comp-\$\{index \+\s*1\}`\s*,/g,
  "id: (comp?.listing_id || comp?.property_id || `2bath-comp-${index + 1}`),"
);

// 8) In case any remaining direct .toLocaleString() on comp.price slipped through, neutralize them
out = out.replace(/comp\.price\.toLocaleString\(\)/g,
  "Number(comp?.price).toLocaleString()"
);

// 9) Guard any reference to comp.pricePerSqft string interpolation if missed
out = out.replace(/\$\{\s*comp\.pricePerSqft\s*\}/g,
  "${Number(comp?.pricePerSqft ?? 0).toFixed(0)}"
);

// 10) Do not fabricate price if missing sqft (optional). If you want to drop comps missing req fields, uncomment:
// out = out.replace(/return\s*{\s*([\s\S]*?)price:\s*\(comp\?\.[^;]*?\),/g, (m) => {
//   return m.replace(/return\s*{/, "if (!Number.isFinite(Number(comp?.price)) || !Number.isFinite(Number(comp?.sqft))) return null;\n      return {");
// });

if (out === src) {
  console.log('ℹ️ No changes applied (patterns not found). Your file may already be patched or differs significantly.');
} else {
  fs.writeFileSync(target, out, 'utf8');
  console.log('✅ Patched', target);
  console.log('• Backup saved as', backup);
}
