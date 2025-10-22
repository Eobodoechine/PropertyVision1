#!/usr/bin/env tsx
/**
 * Local ARV Analysis Runner
 * Interactive tool to run complete ARV analysis locally with full debugging visibility
 */

import * as readline from 'readline';
import { randomUUID } from 'crypto';
import { ComprehensiveComparableSearchV10 } from '../src/server/comprehensive-comp-search-v10';
import { runWithJobContext } from '../src/server/utils/jobLogger';
import { flushCloud } from '../src/server/utils/cloudLogging';

// Set up environment for local testing with caching
process.env.RUN_WORKER = 'false'; // Don't start worker server
process.env.USE_PUBSUB = 'false';
process.env.NODE_ENV = 'development';
process.env.ENABLE_CLOUD_LOGGING = 'true'; // Explicit toggle for Cloud Logging

// Vertex cache settings
process.env.PV_VERTEX_RPS = '6';
process.env.PV_VERTEX_MAX_CONCURRENCY = '4';
process.env.PV_VERTEX_MAX_ATTEMPTS = '7';
process.env.PV_VERTEX_TIMEOUT_MS = '120000';
process.env.PV_VERTEX_BASE_DELAY_MS = '500';
process.env.PV_VERTEX_CACHE_TTL = '604800'; // 7 days

// Dedup settings
process.env.PV_DEDUP_MAXTOKENS = '4096';

// Clear Firebase/service account env vars to force ADC (Application Default Credentials)
// This allows local testing to use gcloud auth instead of service account JSON
delete process.env.FIREBASE_ADMIN_SDK;
delete process.env.GCP_SA_JSON_B64;
delete process.env.GCP_SA_JSON;
delete process.env.SERVICE_ACCOUNT_JSON;

interface ProbeLog {
  probe?: string;
  source?: 'cache' | 'vertex';
  durMs?: number;
  level?: string;
}

class AnalysisRunner {
  private cacheHits = 0;
  private cacheMisses = 0;
  private probes: ProbeLog[] = [];
  private startTime = 0;

  constructor() {
    // Intercept console.log to capture probe logs
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      // Call original
      originalLog(...args);

      // Try to parse probe logs
      if (args.length === 1 && typeof args[0] === 'string') {
        try {
          const parsed = JSON.parse(args[0]);
          if (parsed.probe) {
            this.probes.push(parsed);
            if (parsed.source === 'cache') {
              this.cacheHits++;
            } else if (parsed.source === 'vertex') {
              this.cacheMisses++;
            }
          }
        } catch {
          // Not JSON, ignore
        }
      }
    };
  }

  async promptForAddress(): Promise<string> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      rl.question('\n📍 Enter address: ', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  printHeader(jobId: string) {
    console.log('\n');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  🏠 Local ARV Analysis Runner');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    console.log(`🆔 Job ID: ${jobId}`);
    console.log('');
    console.log('Configuration:');
    console.log(`  RPS: ${process.env.PV_VERTEX_RPS}`);
    console.log(`  Concurrency: ${process.env.PV_VERTEX_MAX_CONCURRENCY}`);
    console.log(`  Max Attempts: ${process.env.PV_VERTEX_MAX_ATTEMPTS}`);
    console.log(`  Cache TTL: ${process.env.PV_VERTEX_CACHE_TTL}s (7 days)`);
    console.log('');
  }

  async runAnalysis(address: string, jobId: string) {
    console.log('───────────────────────────────────────────────────────────');
    console.log(`📍 Address: ${address}`);
    console.log('───────────────────────────────────────────────────────────');
    console.log('');

    this.startTime = Date.now();
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.probes = [];

    // Run analysis within job context so all probe logs include jobId
    return runWithJobContext(jobId, async () => {
      try {
        console.log('🚀 Starting ARV analysis...\n');

        const analyzer = new ComprehensiveComparableSearchV10();
        const result = await analyzer.findComparables(address);

        const duration = Date.now() - this.startTime;

      console.log('\n');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('  ✅ ANALYSIS COMPLETE');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('');

      this.printResults(result, duration);
        this.printCacheStats();
        this.printProbeBreakdown();

        return result;
      } catch (error: any) {
        const duration = Date.now() - this.startTime;

        console.log('\n');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('  ❌ ANALYSIS FAILED');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');
        console.log(`Error: ${error.message}`);
        console.log(`Duration: ${(duration / 1000).toFixed(1)}s`);
        console.log('');

        this.printCacheStats();
        this.printProbeBreakdown();

        throw error;
      } finally {
        // Flush Cloud Logging queue to ensure all logs are written
        if (process.env.NODE_ENV === 'development') {
          await flushCloud();
        }
      }
    });
  }

  private printResults(result: any, duration: number) {
    console.log('📊 Results:');
    console.log(`  Subject Address: ${result.subject?.address || 'N/A'}`);
    console.log(`  ARV Estimate: $${result.arv?.estimate?.toLocaleString() || 'N/A'}`);
    console.log(`  Confidence: ${result.arv?.confidence || 'N/A'}`);
    console.log(`  Qualified Comps: ${result.qualified_comps?.length || 0}`);
    console.log(`  Total Comps Found: ${result.all_comps?.length || 0}`);
    console.log(`  Analysis Duration: ${(duration / 1000).toFixed(1)}s`);
    console.log('');
  }

  private printCacheStats() {
    const total = this.cacheHits + this.cacheMisses;
    const hitRate = total > 0 ? ((this.cacheHits / total) * 100).toFixed(1) : '0.0';

    console.log('🔍 Cache Statistics:');
    console.log(`  Cache Hits: ${this.cacheHits}`);
    console.log(`  Cache Misses: ${this.cacheMisses}`);
    console.log(`  Total Calls: ${total}`);
    console.log(`  Hit Rate: ${hitRate}%`);
    console.log('');
  }

  private printProbeBreakdown() {
    // Group probes by name
    const probeCount: Record<string, number> = {};
    for (const p of this.probes) {
      if (p.probe) {
        probeCount[p.probe] = (probeCount[p.probe] || 0) + 1;
      }
    }

    console.log('📝 Probe Summary:');
    const sortedProbes = Object.entries(probeCount).sort((a, b) => b[1] - a[1]);
    for (const [name, count] of sortedProbes) {
      console.log(`  ${name.padEnd(40)} ${count.toString().padStart(3)}`);
    }
    console.log('');
  }
}

async function main() {
  const jobId = randomUUID();
  const runner = new AnalysisRunner();
  runner.printHeader(jobId);

  const address = await runner.promptForAddress();

  if (!address) {
    console.log('❌ No address provided');
    process.exit(1);
  }

  try {
    await runner.runAnalysis(address, jobId);
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`✅ Done! To download logs, run:`);
    console.log(`   ./scripts/download-job-logs.sh ${jobId}`);
    console.log('═══════════════════════════════════════════════════════════\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Analysis failed');
    console.error(`To view logs: ./scripts/download-job-logs.sh ${jobId}\n`);
    process.exit(1);
  }
}

main();
