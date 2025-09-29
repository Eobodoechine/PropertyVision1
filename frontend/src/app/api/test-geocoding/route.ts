import { NextRequest, NextResponse } from 'next/server';
import { testAddressNormalization } from '../../../server/vertex-details';

export async function GET(request: NextRequest) {
  try {
    console.log('🧪 Starting address normalization test...');

    await testAddressNormalization();

    return NextResponse.json({
      success: true,
      message: 'Address normalization test completed - check server logs'
    });
  } catch (error) {
    console.error('❌ Test failed:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}