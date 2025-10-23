import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Debug logging
console.log('🚀 Starting simple server...');
console.log('📂 Current directory:', process.cwd());
console.log('🌍 Environment variables loaded:', {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY ? 'PRESENT' : 'MISSING',
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY ? 'PRESENT' : 'MISSING'
});

// Routes
app.get('/api/health', (req, res) => {
  console.log('📊 Health check requested');
  res.json({ 
    ok: true, 
    time: new Date().toISOString(),
    server: 'simple-server',
    port: PORT
  });
});

// Add both endpoints for compatibility
app.post('/api/analyze', async (req, res) => {
  try {
    const { address } = req.body;
    
    if (!address) {
      return res.status(400).json({ error: 'Address is required' });
    }

    console.log(`🔍 Starting analysis for: ${address}`);
    
    // Import the FullAnalysisService dynamically
    console.log('📦 Importing FullAnalysisService...');
    const { FullAnalysisService } = await import('./server/full-analysis.js');
    
    console.log('🏗️ Creating analysis service...');
    const analysisService = new FullAnalysisService();
    
    console.log('🔄 Running analysis...');
    const result = await analysisService.runFullAnalysis(address);
    
    console.log('✅ Analysis completed successfully');
    res.json(result);
  } catch (error) {
    console.error('❌ Analysis failed:', error);
    res.status(500).json({ 
      error: 'Analysis failed', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});

// Add the endpoint the frontend expects
app.post('/api/property/analyze', async (req, res) => {
  try {
    const { address } = req.body;
    
    if (!address) {
      return res.status(400).json({ error: 'Address is required' });
    }

    console.log(`🔍 [PROPERTY ENDPOINT] Starting analysis for: ${address}`);
    
    // Import the FullAnalysisService dynamically
    console.log('📦 Importing FullAnalysisService...');
    const { FullAnalysisService } = await import('./server/full-analysis.js');
    
    console.log('🏗️ Creating analysis service...');
    const analysisService = new FullAnalysisService();
    
    console.log('🔄 Running analysis...');
    const result = await analysisService.runFullAnalysis(address);
    
    console.log('✅ Analysis completed successfully');
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
  console.log(`✅ Simple server running on http://localhost:${PORT}`);
  console.log(`📊 Health: http://localhost:${PORT}/api/health`);
  console.log(`🔍 Analysis: POST http://localhost:${PORT}/api/analyze`);
});
