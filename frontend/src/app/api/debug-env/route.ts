import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    hasGoogleMapsKey: !!process.env.GOOGLE_MAPS_API_KEY,
    hasServiceAccount: !!process.env.GCP_SA_JSON_B64,
    saLength: process.env.GCP_SA_JSON_B64?.length || 0,
    saPreview: process.env.GCP_SA_JSON_B64?.substring(0, 50) || 'undefined',
    nodeEnv: process.env.NODE_ENV,
    keys: Object.keys(process.env).filter(k => k.startsWith('GCP_') || k.startsWith('GOOGLE_'))
  });
}