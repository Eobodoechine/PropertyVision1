import { NextRequest, NextResponse } from 'next/server';
import { ComprehensiveCompSearchV3 } from '../../../server/comprehensive-comp-search-v3';

let analysisService: ComprehensiveCompSearchV3;

// Initialize the service (singleton pattern)
function getAnalysisService() {
  if (!analysisService) {
    analysisService = new ComprehensiveCompSearchV3();
  }
  return analysisService;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const address = String(body?.address || '').trim();

    if (!address) {
      return NextResponse.json(
        { error: 'Address is required' },
        { status: 400 }
      );
    }

    const service = getAnalysisService();
    const result = await service.findComparables(address);

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

    return NextResponse.json(responsePayload);
  } catch (error: any) {
    const message = error?.message || 'Analysis failed';
    console.error('❌ Analysis failed:', message);

    return NextResponse.json(
      { error: 'Analysis failed', details: message },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { message: 'Use POST method to analyze properties' },
    { status: 405 }
  );
}