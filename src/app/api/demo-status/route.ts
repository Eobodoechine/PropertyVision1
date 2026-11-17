import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Tells the page whether live analyses are available on this deployment.
export async function GET() {
  const liveSwitch = (process.env.LIVE_ANALYSIS || 'on').toLowerCase() !== 'off';
  const hasModelAccess = !!process.env.ANTHROPIC_API_KEY || (process.env.LLM_PROVIDER || '').toLowerCase() === 'claude-cli';
  return NextResponse.json({ live: liveSwitch && hasModelAccess });
}
