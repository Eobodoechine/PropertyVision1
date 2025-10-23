import 'dotenv/config';
import { vertexGenerate } from '../server/vertex-freeform.js';
import fs from 'fs';

async function debugLLMParsing() {
  console.log('🐛 DEBUG: LLM Parsing Error');
  console.log('============================================================');

  try {
    const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON;
    if (!saPath) {
      console.log('❌ No service account path found');
      return;
    }

    const serviceAccount = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
    const projectId = serviceAccount.project_id;
    const location = 'us-central1';
    const model = 'gemini-2.5-pro';

    console.log('✅ Service account loaded');
    console.log(`📍 Project: ${projectId}`);

    // Test simple LLM call
    const testPrompt = 'Extract the sale price from this text: "Property sold for $445,000". Return only the number.';

    console.log('🧪 Testing simple LLM call...');
    const result = await vertexGenerate({
      sa: serviceAccount,
      projectId,
      location,
      model,
      prompt: testPrompt,
      grounded: false,
      json: false,
      timeoutMs: 10000
    });

    console.log(`✅ LLM Result: "${result}"`);

  } catch (error: any) {
    console.log(`❌ LLM Error: ${error.message}`);
    console.log(`Stack: ${error.stack}`);
  }
}

debugLLMParsing().catch(console.error);