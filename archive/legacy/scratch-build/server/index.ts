import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.post('/api/analyze', async (req, res) => {
  try {
    const { address } = req.body;
    
    if (!address) {
      return res.status(400).json({ error: 'Address is required' });
    }

    console.log(`🔍 Analyzing: ${address}`);
    
    // Simulate analysis
    const result = {
      address,
      arv: "$250,000",
      confidence: "High",
      comparables: [
        { address: "123 Sample St", price: 240000, sqft: 1200 },
        { address: "456 Demo Ave", price: 260000, sqft: 1300 }
      ]
    };
    
    res.json(result);
  } catch (error) {
    console.error('Analysis failed:', error);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Health: http://localhost:${PORT}/api/health`);
  console.log(`🔍 Analysis: POST http://localhost:${PORT}/api/analyze`);
});
