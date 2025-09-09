// Quick checker to evaluate if a candidate address qualifies as a comp
// Usage: tsx server/tools/checkComp.ts "<subject address>" "<candidate address>"
import 'dotenv/config';
import { loadAppEnv } from '../utils/envLoader';
import { MemStorage } from "../storage";

function monthsBetween(d1: Date, d2: Date) {
  const years = d2.getFullYear() - d1.getFullYear();
  const months = d2.getMonth() - d1.getMonth();
  return years * 12 + months - (d2.getDate() < d1.getDate() ? 1 : 0);
}

async function main() {
  const subjAddr = process.argv[2] || "243 Kirk Ave Henderson NV 89015";
  const candAddr = process.argv[3] || "239 Concho Dr Henderson NV 89015";

  // Load env from .env.local, .env, and user config
  loadAppEnv();
  if (!process.env.RAPIDAPI_KEY) {
    console.error(JSON.stringify({ error: 'missing_RAPIDAPI_KEY' }));
    process.exit(4);
  }

  const ms: any = new MemStorage();

  const subj = await ms.findByAutocomplete(subjAddr);
  if (!subj) {
    console.error(JSON.stringify({ error: "subject_not_found", address: subjAddr }));
    process.exit(2);
  }
  const cand = await ms.findByAutocomplete(candAddr);
  if (!cand) {
    console.error(JSON.stringify({ error: "candidate_not_found", address: candAddr }));
    process.exit(3);
  }

  const subjSqft = Number(subj?.description?.sqft) || NaN;
  const subjBeds = Number(subj?.description?.beds) || NaN;
  const subjBaths = Number(subj?.description?.baths) || NaN;
  const subjYear = Number(subj?.description?.year_built) || NaN;

  const minSqft = Math.round(subjSqft * 0.8);
  const maxSqft = Math.round(subjSqft * 1.2);

  const cSqft = Number(cand?.description?.sqft) || NaN;
  const cBeds = Number(cand?.description?.beds) || NaN;
  const cBaths = Number(cand?.description?.baths) || NaN;
  const cYear = Number(cand?.description?.year_built) || NaN;
  const cPrice = Number(cand?.last_sold_price) || NaN;
  const cSold = cand?.last_sold_date ? new Date(cand.last_sold_date) : null;
  const today = new Date();
  const monthsAgo = cSold ? monthsBetween(cSold, today) : Infinity;
  const ppsf = Number.isFinite(cPrice) && Number.isFinite(cSqft) && cSqft > 0 ? Math.round(cPrice / cSqft) : NaN;

  const sizeOk = Number.isFinite(cSqft) && Number.isFinite(subjSqft) && cSqft >= minSqft && cSqft <= maxSqft;
  const priceOk = Number.isFinite(ppsf) && ppsf >= 50 && ppsf <= 300 && Number.isFinite(cPrice) && cPrice > 10000;
  const timeOk = monthsAgo <= 24; // Using 24 months as wider window
  const bathOk = Number.isFinite(cBaths) && Number.isFinite(subjBaths) && cBaths <= subjBaths + 1e-9;
  const yearOk = Number.isFinite(subjYear) ? (Number.isFinite(cYear) ? cYear <= subjYear + 10 : true) : true;
  const type = String(subj?.description?.type || '').toLowerCase();
  const candType = String(cand?.description?.type || '').toLowerCase();
  const typeOk = candType ? (type ? candType === type : true) : true;

  const decision = sizeOk && priceOk && timeOk && bathOk && yearOk && typeOk;

  console.log(JSON.stringify({
    subject: {
      address: subjAddr,
      sqft: subjSqft || null,
      beds: subjBeds || null,
      baths: subjBaths || null,
      year: subjYear || null,
    },
    candidate: {
      address: candAddr,
      type: candType || null,
      sqft: cSqft || null,
      beds: cBeds || null,
      baths: cBaths || null,
      year: cYear || null,
      lastSoldPrice: Number.isFinite(cPrice) ? cPrice : null,
      lastSoldDate: cSold ? cSold.toISOString().slice(0, 10) : null,
      pricePerSqft: Number.isFinite(ppsf) ? ppsf : null,
      monthsSinceSale: Number.isFinite(monthsAgo) ? monthsAgo : null,
    },
    criteria: {
      minSqft, maxSqft,
      ppsfRange: [50, 300],
      windowMonths: 24,
      yearUpperBound: Number.isFinite(subjYear) ? subjYear + 10 : null,
    },
    passes: { sizeOk, priceOk, timeOk, bathOk, yearOk, typeOk },
    isComp: decision
  }));
}

main().catch(err => {
  console.error(JSON.stringify({ error: String(err?.message || err) }));
  process.exit(1);
});
