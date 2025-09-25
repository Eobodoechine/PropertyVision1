import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { ComprehensiveCompSearchV3 } from './comprehensive-comp-search-v3.js';

const app = express();
const port = Number(process.env.PORT) || 3001;
const host = process.env.HOST || '0.0.0.0';

const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim()).filter(Boolean)
  : undefined;

app.use(corsOrigins?.length ? cors({ origin: corsOrigins, credentials: true }) : cors());
app.use(express.json({ limit: '1mb' }));

const analysisService = new ComprehensiveCompSearchV3();

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.post('/api/analyze', async (req, res) => {
  try {
    const address = String(req.body?.address || '').trim();
    if (!address) {
      return res.status(400).json({ error: 'Address is required' });
    }

    const result = await analysisService.findComparables(address);

    const responsePayload = {
      subject: result.subject,
      arv: result.arv ?? null,
      twoBathArv: result.twoBathARV ?? null,
      bathroomAnalysis: result.bathroomAnalysis,
      renovationAnalysis: result.renovation_analysis,
      compsUsed: result.qualified_comps,
      allComps: result.all_comps,
      confidenceScores: Object.fromEntries(result.consistency_scores.entries()),
      searchMetadata: result.searchMetadata,
    };

    res.json(responsePayload);
  } catch (error: any) {
    const message = error?.message || 'Analysis failed';
    console.error('❌ Analysis failed:', message);
    res.status(500).json({ error: 'Analysis failed', details: message });
  }
});

app.listen(port, host, () => {
  console.log(`✅ Comprehensive analysis API ready on http://${host}:${port}`);
});
