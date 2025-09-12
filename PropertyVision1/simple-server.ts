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
  console.log('📊 Health check requested');
  res.json({ ok: true, time: new Date().toISOString() });
});

app.post('/api/analyze', async (req, res) => {
  try {
    const { address } = req.body;
    
    if (!address) {
      return res.status(400).json({ error: 'Address is required' });
    }

    console.log(`🔍 Starting analysis for: ${address}`);
    
    // Import and use the FullAnalysisService
    const { FullAnalysisService } = await import('./server/full-analysis.js');
    const analysisService = new FullAnalysisService();
    
    const result = await analysisService.runFullAnalysis(address);
    
    res.json(result);
  } catch (error) {
    console.error('❌ Analysis failed:', error);
    res.status(500).json({ 
      error: 'Analysis failed', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Simple server running on http://localhost:${PORT}`);
  console.log(`📊 Health: http://localhost:${PORT}/api/health`);
  console.log(`🔍 Analysis: POST http://localhost:${PORT}/api/analyze`);
});
