import 'dotenv/config';
import { storage } from './storage';

async function main() {
  const address = process.env.ADDRESS;
  if (!address || address.trim().length < 10) {
    console.error('ADDRESS env var is required (full street, city, state, ZIP).');
    process.exit(1);
  }
  if (!process.env.RAPIDAPI_KEY) {
    console.error('RAPIDAPI_KEY env var is required.');
    process.exit(1);
  }
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    console.error('GOOGLE_MAPS_API_KEY env var is required.');
    process.exit(1);
  }

  console.log(`Analyzing: ${address}`);
  const res: any = await storage.analyzeProperty({ address });
  const baseArv = res?.arv ? Number(res.arv) : NaN;
  const basePpsf = res?.pricePerSqFt ? Number(res.pricePerSqFt) : NaN;
  const twoBathArv = res?.arvWith2ndBathroom?.estimate ? Number(res.arvWith2ndBathroom.estimate) : null;
  const twoBathPpsf = res?.arvWith2ndBathroom?.pricePerSqFt ? Number(res.arvWith2ndBathroom.pricePerSqFt) : null;

  console.log('\n=== RESULT SUMMARY ===');
  console.log(`Baseline ARV: $${Number.isFinite(baseArv) ? baseArv.toLocaleString() : 'N/A'} ($${Number.isFinite(basePpsf) ? basePpsf.toFixed(0) : 'N/A'}/sqft)`);
  if (twoBathArv != null) {
    console.log(`2-Bath ARV:   $${twoBathArv.toLocaleString()} ($${twoBathPpsf != null ? twoBathPpsf.toFixed(0) : 'N/A'}/sqft)`);
  } else {
    console.log('2-Bath ARV:   N/A (not applicable)');
  }
}

main().catch(err => {
  console.error('Run failed:', err);
  process.exit(1);
});

