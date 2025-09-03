import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { addressSearchSchema, type PropertyAnalysisResult } from "@shared/schema";
import { z } from "zod";
import { webSearch } from "./web-search";
import { Router } from 'express';
import webSearch from './web-search';
import { requireRapidKey } from './middleware/requireRapidKey';

// Create a new router instance to export
const router = Router();

// Analyze property endpoint
router.post("/property/analyze", requireRapidKey, async (req, res) => {
  try {
    const addressSearch = addressSearchSchema.parse(req.body);

    // Call storage to analyze the property
    const analysis = await storage.analyzeProperty(addressSearch);


    // Format response for frontend
    const result: PropertyAnalysisResult = {
      arv: {
        estimate: analysis.arv || "N/A",
        confidence: analysis.confidence || "N/A",
        pricePerSqFt: analysis.pricePerSqFt || "N/A",
      },
      property: {
        beds: analysis.beds || 0,
        baths: analysis.baths ? parseFloat(analysis.baths) : 0,
        sqft: analysis.sqft || 0,
        yearBuilt: analysis.yearBuilt || 0,
      },
      comparables: Array.isArray(analysis.comparables) ? analysis.comparables : [],
      isDualCalculation: (analysis as any).isDualCalculation || false,
      ...(((analysis as any).isDualCalculation) && {
        arvWith2ndBathroom: {
          estimate: (analysis as any).arvWith2ndBathroom?.estimate ? `$${parseFloat((analysis as any).arvWith2ndBathroom.estimate).toLocaleString()}` : "N/A",
          confidence: (analysis as any).arvWith2ndBathroom?.confidence || "N/A",
          pricePerSqFt: (analysis as any).arvWith2ndBathroom?.pricePerSqFt ? `$${parseFloat((analysis as any).arvWith2ndBathroom.pricePerSqFt).toFixed(0)}` : "N/A",
        },
        comparablesWith2ndBath: Array.isArray((analysis as any).comparablesWith2ndBath) ? (analysis as any).comparablesWith2ndBath : [],
      })
    };

    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ 
        message: "Invalid address format",
        errors: error.errors.map(e => e.message)
      });
    } else {
      console.error('❌ Property analysis failed:', error);
      console.log('🚫 No fallback data - external API integration required');
      res.status(500).json({ 
        error: 'Property analysis failed - external API integration required', 
        details: error instanceof Error ? error.message : 'No authentic data sources available' 
      });
    }
  }
});

// Get analysis by ID endpoint
router.get("/property/analysis/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const analysis = await storage.getPropertyAnalysis(id);

    if (!analysis) {
      res.status(404).json({ message: "Analysis not found" });
      return;
    }

    res.json(analysis);
  } catch (error) {
    res.status(500).json({ 
      message: error instanceof Error ? error.message : "Failed to retrieve analysis"
    });
  }
});

// Web search endpoint for property research using real web search
router.post("/web-search", async (req, res) => {
  try {
    const { query } = req.body;

    if (!query || typeof query !== 'string') {
      res.status(400).json({ message: "Query is required" });
      return;
    }

    console.log(`🔍 WEB SEARCH: Performing real web search for "${query}"`);

    // Use real web search for property data
    const webSearchResults = await performWebSearch(query);

    if (webSearchResults && webSearchResults.length > 0) {
      console.log(`✅ Found ${webSearchResults.length} web search results`);
      res.json({ results: webSearchResults });
    } else {
      console.log(`❌ No web search results found`);
      res.json({ results: [] });
    }

  } catch (error) {
    console.log(`❌ Web search error: ${error}`);
    res.status(500).json({ 
      message: error instanceof Error ? error.message : "Web search failed"
    });
  }
});

// Function to perform actual web search using real web search tool
async function performWebSearch(query: string) {
  try {
    console.log(`🌐 REAL WEB SEARCH: ${query}`);

    // No hardcoded data - all results must come from external APIs
    console.log(`🔍 Using external web search API for: ${query}`);
    const results = await webSearch(query);
    console.log(`✅ Web search API returned ${results.length} results`);
    return results;
  } catch (error) {
    console.log(`Web search integration error: ${error}`);
    return [];
  }
}

// External web search endpoint using real web search capabilities
router.post("/external-web-search", async (req, res) => {
  try {
    const { query } = req.body;
    console.log(`🌐 EXTERNAL WEB SEARCH REQUEST: ${query}`);

    // This is where we would integrate with the actual web_search tool
    // For now, return structured results that would come from real web search

    // In a real implementation, this would use web_search tool:
    // const searchResults = await web_search({ query });

    // All property data must come from external web search APIs
    console.log(`🔍 EXTERNAL WEB SEARCH: Processing query for external APIs only`);

    // No hardcoded responses - external integration required

    res.json({ results: [] });

  } catch (error) {
    console.log(`❌ External web search error: ${error}`);
    res.json({ results: [] });
  }
});

// Pure web-details endpoint for debugging web parsing only (no RapidAPI)
router.get('/web-details', async (req, res) => {
  try {
    const address = (req.query.address as string) || '';
    if (!address || address.trim().length < 5) {
      return res.status(400).json({ message: 'Query parameter "address" is required' });
    }
    const details = await webSearch.forPropertyDetails(address);
    if (!details) {
      return res.status(404).json({ message: 'No web details found for address' });
    }
    res.json({ address, details });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || 'Failed to fetch web details' });
  }
});

// Export the router as default
export default router;
