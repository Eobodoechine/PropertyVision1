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

app.get('/', (_req, res) => {
  res.send(`
    <html>
      <head><title>PropertyVision1 API</title></head>
      <body>
        <h1>PropertyVision1 API Server</h1>
        <p>Version 3.0</p>

        <h2>Test Property Analysis</h2>
        <form id="analyzeForm">
          <label for="address">Property Address:</label><br>
          <input type="text" id="address" name="address" style="width: 300px; padding: 5px;"
                 placeholder="e.g., 123 Main St, City, State"><br><br>
          <button type="submit">Analyze Property</button>
        </form>

        <div id="result" style="margin-top: 20px;"></div>

        <script>
          document.getElementById('analyzeForm').onsubmit = async function(e) {
            e.preventDefault();
            const address = document.getElementById('address').value;
            const resultDiv = document.getElementById('result');

            if (!address) {
              resultDiv.innerHTML = '<p style="color: red;">Please enter an address</p>';
              return;
            }

            resultDiv.innerHTML = '<p>Analyzing...</p>';

            try {
              const response = await fetch('/api/analyze', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({address: address})
              });

              const data = await response.json();
              resultDiv.innerHTML = '<pre>' + JSON.stringify(data, null, 2) + '</pre>';
            } catch (error) {
              resultDiv.innerHTML = '<p style="color: red;">Error: ' + error.message + '</p>';
            }
          };
        </script>
      </body>
    </html>
  `);
});

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
