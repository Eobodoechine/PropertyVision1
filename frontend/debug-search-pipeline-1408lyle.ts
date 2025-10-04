// Systematic Debugging Framework for 1408 Lyle Ave Pipeline Issue
// Based on user's provided debugging methodology

import { ProgressiveSearchStrategy } from './src/server/utils/progressiveSearchStrategy.js';

interface StateCheckpoint {
  stage: string;
  timestamp: string;
  inputCount: number;
  outputCount: number;
  data: any[];
  processedItems?: any[];
  droppedItems?: any[];
  notes: string;
}

class SearchPipelineDebugger {
  private checkpoints: StateCheckpoint[] = [];

  captureState(stage: string, input: any[], output: any[], notes: string = '', extras?: any) {
    const checkpoint: StateCheckpoint = {
      stage,
      timestamp: new Date().toISOString(),
      inputCount: input?.length || 0,
      outputCount: output?.length || 0,
      data: output || [],
      notes,
      ...extras
    };

    this.checkpoints.push(checkpoint);

    console.log(`\n🔍 CHECKPOINT: ${stage}`);
    console.log(`   📊 Input: ${checkpoint.inputCount} → Output: ${checkpoint.outputCount}`);
    console.log(`   📝 ${notes}`);

    if (extras?.processedItems) {
      console.log(`   ✅ Processed: ${extras.processedItems.length}`);
    }
    if (extras?.droppedItems) {
      console.log(`   ❌ Dropped: ${extras.droppedItems.length}`);
    }
  }

  findMissingProperty(address: string, partialMatch: boolean = false): StateCheckpoint[] {
    console.log(`\n🔎 TRACING: ${address}`);
    console.log('================================');

    const found: StateCheckpoint[] = [];

    this.checkpoints.forEach((checkpoint, index) => {
      const hasProperty = checkpoint.data.some(item => {
        if (partialMatch) {
          return item.address?.toLowerCase().includes(address.toLowerCase()) ||
                 item.address?.toLowerCase().includes('lyle');
        }
        return item.address?.toLowerCase().includes(address.toLowerCase());
      });

      if (hasProperty) {
        console.log(`✅ FOUND at ${checkpoint.stage}: ${checkpoint.outputCount} items`);
        found.push(checkpoint);
      } else {
        console.log(`❌ MISSING at ${checkpoint.stage}: ${checkpoint.outputCount} items`);
      }
    });

    return found;
  }

  analyzeDataFlow() {
    console.log('\n📊 PIPELINE FLOW ANALYSIS');
    console.log('==========================');

    this.checkpoints.forEach((checkpoint, index) => {
      const prev = index > 0 ? this.checkpoints[index - 1] : null;
      const delta = prev ? checkpoint.outputCount - prev.outputCount : checkpoint.outputCount;
      const deltaSign = delta > 0 ? '+' : '';

      console.log(`${index + 1}. ${checkpoint.stage}: ${checkpoint.outputCount} items (${deltaSign}${delta})`);
      console.log(`   📝 ${checkpoint.notes}`);
    });
  }

  getDataLossPoints(): string[] {
    const lossPoints: string[] = [];

    for (let i = 1; i < this.checkpoints.length; i++) {
      const prev = this.checkpoints[i - 1];
      const curr = this.checkpoints[i];

      if (curr.outputCount < prev.outputCount) {
        const loss = prev.outputCount - curr.outputCount;
        lossPoints.push(`${prev.stage} → ${curr.stage}: Lost ${loss} items`);
      }
    }

    return lossPoints;
  }
}

async function debugSearchPipeline1408Lyle() {
  console.log('🚨 SYSTEMATIC DEBUGGING: 1408 Lyle Ave Pipeline Issue');
  console.log('====================================================');
  console.log('Goal: Track exactly where 1408 Lyle Ave gets lost between');
  console.log('      individual filter validation and final count');

  const pipelineDebugger = new SearchPipelineDebugger();
  const strategy = new ProgressiveSearchStrategy();

  // 1. DATA VALIDATION & ISOLATION
  console.log('\n1️⃣ CONTROLLED TEST DATA');
  console.log('========================');

  const subjectProperty = {
    address: "3128 McKenzie Dr, East Point, GA 30344",
    sqft: 1323,
    bedrooms: 4,
    bathrooms: 3,
    yearBuilt: 1955,
    lat: 33.6946462,
    lng: -84.4630528
  };

  // Mock search service that returns the exact 1408 Lyle Ave property
  const mockSearchService = {
    async searchComparables(address, radius, propertyType, limit) {
      console.log(`📡 MOCK SEARCH: radius=${radius}mi, limit=${limit}`);

      // Level 1 (1 mile): Return 1408 Lyle Ave as the only result
      if (radius === 1) {
        const mockResults = [
          {
            id: "1408_LYLE_AVE",
            address: "1408 Lyle Ave, East Point, GA 30344",
            price: 394000,
            sqft: 1776,
            bedrooms: 4,
            bathrooms: 3,
            yearBuilt: 1971,
            saleDate: "2025-07-15", // Recent sale (within 18 months)
            lat: 33.6950000, // Within 1 mile of subject
            lng: -84.4635000,
            property_type: "single_family"
          }
        ];

        pipelineDebugger.captureState(
          'MOCK_VERTEX_RESPONSE',
          [],
          mockResults,
          'Mock Vertex AI returns 1408 Lyle Ave for Level 1 search'
        );

        return mockResults;
      }

      return [];
    }
  };

  console.log('\n📍 Subject Property:');
  console.log(`   ${subjectProperty.address}`);
  console.log(`   ${subjectProperty.bedrooms}BR/${subjectProperty.bathrooms}BA, ${subjectProperty.sqft}sqft`);
  console.log(`   Coordinates: ${subjectProperty.lat}, ${subjectProperty.lng}`);

  console.log('\n🎯 Expected 1408 Lyle Ave Property:');
  console.log('   Address: 1408 Lyle Ave, East Point, GA 30344');
  console.log('   Price: $394,000 | 1776 sqft | $221.85/sqft');
  console.log('   4BR/3BA | Built: 1971 | Sale: 2025-07-15');
  console.log('   Should PASS all filters but gets LOST in aggregation');

  try {
    console.log('\n2️⃣ PROGRESSIVE SEARCH EXECUTION');
    console.log('================================');

    // STEP 1: Execute the progressive search with debugging
    const result = await strategy.executeProgressiveSearch(
      subjectProperty.address,
      subjectProperty,
      mockSearchService,
      'single_family'
    );

    // STEP 2: Analyze the final result
    pipelineDebugger.captureState(
      'FINAL_RESULT',
      [],
      result.comparables || [],
      `Final result: ${result.success ? 'SUCCESS' : 'FAILED'} | Method: ${result.searchStrategy}`
    );

    console.log('\n3️⃣ RESULT ANALYSIS');
    console.log('==================');
    console.log(`✅ Success: ${result.success}`);
    console.log(`📊 Total Comps: ${result.comparables?.length || 0}`);
    console.log(`🎯 Method: ${result.searchStrategy}`);
    console.log(`📝 Details: ${result.details}`);

    if (result.comparables && result.comparables.length > 0) {
      console.log('\n🏠 FINAL COMPS:');
      result.comparables.forEach((comp, i) => {
        const ppsf = comp.price / comp.sqft;
        console.log(`${i+1}. ${comp.address}: $${comp.price.toLocaleString()} | ${comp.sqft}sqft | $${ppsf.toFixed(2)}/sqft`);
      });
    } else {
      console.log('\n❌ NO FINAL COMPS FOUND!');
    }

    // STEP 3: Track 1408 Lyle Ave through the pipeline
    console.log('\n4️⃣ PROPERTY TRACKING');
    console.log('====================');

    const foundLocations = pipelineDebugger.findMissingProperty("1408 Lyle Ave", true);

    if (foundLocations.length === 0) {
      console.log('🚨 CRITICAL: 1408 Lyle Ave was NEVER captured in any checkpoint!');
      console.log('🔍 This suggests the issue is in the initial search or very early filtering');
    } else {
      console.log(`✅ 1408 Lyle Ave found in ${foundLocations.length} checkpoints`);

      // Find where it disappeared
      const allStages = pipelineDebugger.checkpoints.map(c => c.stage);
      const foundStages = foundLocations.map(c => c.stage);
      const missingStages = allStages.filter(stage => !foundStages.includes(stage));

      if (missingStages.length > 0) {
        console.log('\n🚨 1408 Lyle Ave DISAPPEARED after these stages:');
        missingStages.forEach(stage => {
          console.log(`   ❌ ${stage}`);
        });
      }
    }

    // STEP 4: Analyze data flow and loss points
    console.log('\n5️⃣ PIPELINE ANALYSIS');
    console.log('====================');

    pipelineDebugger.analyzeDataFlow();

    const lossPoints = pipelineDebugger.getDataLossPoints();
    if (lossPoints.length > 0) {
      console.log('\n🔥 DATA LOSS POINTS:');
      lossPoints.forEach(point => console.log(`   🚨 ${point}`));
    }

    // STEP 5: Diagnosis and recommendations
    console.log('\n6️⃣ DIAGNOSIS & RECOMMENDATIONS');
    console.log('===============================');

    if (result.comparables?.length === 0) {
      console.log('🚨 DIAGNOSIS: Level 1 shows "Found: 0 comps" despite 1408 Lyle Ave passing all filters');
      console.log('');
      console.log('🔍 LIKELY CAUSES:');
      console.log('   1. Search aggregation bug in progressive search strategy');
      console.log('   2. Property gets filtered after individual validation');
      console.log('   3. State not properly accumulated between validation and final count');
      console.log('   4. Async/promise handling issue losing valid properties');
      console.log('');
      console.log('🛠️  NEXT STEPS:');
      console.log('   1. Add state dumps to ProgressiveSearchStrategy.executeSearchLevel()');
      console.log('   2. Trace the exact path from Vertex AI response to final count');
      console.log('   3. Check if properties are lost in distance filtering or deduplication');
      console.log('   4. Verify promise resolution order in search pipeline');
    } else {
      console.log('✅ 1408 Lyle Ave successfully tracked through pipeline');
    }

  } catch (error) {
    console.error('❌ Debug execution failed:', error);
    console.error('Stack:', error.stack);
  }
}

debugSearchPipeline1408Lyle().catch(console.error);