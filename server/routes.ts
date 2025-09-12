import { Router } from 'express';

// Create a new router instance to export
const router = Router();

// Simple info endpoint with version stamp for verification
router.get('/info', (_req, res) => {
  res.json({
    service: 'PropertyVision API',
    version: 'gemini-integration-branch',
    time: new Date().toISOString(),
  });
});

// Non-sensitive env presence check (no key values leaked)
router.get('/env-check', (_req, res) => {
  res.json({
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()),
    hasMapsKey: Boolean(process.env.GOOGLE_MAPS_API_KEY && process.env.GOOGLE_MAPS_API_KEY.trim()),
    port: process.env.PORT || '5000'
  });
});

// Add the analysis route that the frontend expects
router.post("/analyze", async (req, res) => {
  try {
    const { address } = req.body;
    
    if (!address) {
      return res.status(400).json({ error: 'Address is required' });
    }

    console.log(`🔍 Starting analysis for: ${address}`);
    
    // Import and use the FullAnalysisService
    const { FullAnalysisService } = await import('./full-analysis.js');
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

// Export the router as default
export default router;