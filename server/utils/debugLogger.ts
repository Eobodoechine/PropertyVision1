// Enhanced debug logging utility for backend operations
import { Console } from 'console';

export class DebugLogger {
  private static instance: DebugLogger;
  private console: Console;
  private isEnabled: boolean;

  constructor() {
    this.console = new Console({
      stdout: process.stdout,
      stderr: process.stderr
    });
    this.isEnabled = process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true';
  }

  static getInstance(): DebugLogger {
    if (!DebugLogger.instance) {
      DebugLogger.instance = new DebugLogger();
    }
    return DebugLogger.instance;
  }

  /**
   * Log API request details
   */
  request(method: string, path: string, body?: any) {
    if (!this.isEnabled) return;

    this.console.log('\n🌐 API REQUEST:');
    this.console.log(`   ${method} ${path}`);
    this.console.log(`   Time: ${new Date().toISOString()}`);
    if (body) {
      this.console.log(`   Body:`, JSON.stringify(body, null, 2));
    }
    this.console.log('───────────────────────────────');
  }

  /**
   * Log sequential gap outlier detection steps
   */
  outlierDetection(step: string, data?: any) {
    if (!this.isEnabled) return;

    this.console.log(`\n🔍 OUTLIER DETECTION - ${step.toUpperCase()}:`);
    if (data) {
      this.console.log(`   ${JSON.stringify(data, null, 2)}`);
    }
    this.console.log('───────────────────────────────');
  }

  /**
   * Log ARV calculation steps
   */
  arv(step: string, data?: any) {
    if (!this.isEnabled) return;

    this.console.log(`\n💰 ARV CALCULATION - ${step.toUpperCase()}:`);
    if (data) {
      this.console.log(`   ${JSON.stringify(data, null, 2)}`);
    }
    this.console.log('───────────────────────────────');
  }

  /**
   * Log comparable search and filtering
   */
  comparables(step: string, data?: any) {
    if (!this.isEnabled) return;

    this.console.log(`\n🏠 COMPARABLES - ${step.toUpperCase()}:`);
    if (data) {
      this.console.log(`   ${JSON.stringify(data, null, 2)}`);
    }
    this.console.log('───────────────────────────────');
  }

  /**
   * Log errors with stack traces
   */
  error(message: string, error?: any) {
    this.console.error(`\n❌ ERROR: ${message}`);
    if (error) {
      this.console.error('   Details:', error);
      if (error.stack) {
        this.console.error('   Stack:', error.stack);
      }
    }
    this.console.error('───────────────────────────────');
  }

  /**
   * Log performance timing
   */
  timing(operation: string, startTime: number) {
    if (!this.isEnabled) return;

    const duration = Date.now() - startTime;
    this.console.log(`\n⏱️  TIMING: ${operation} took ${duration}ms`);
    this.console.log('───────────────────────────────');
  }

  /**
   * Log general debug info
   */
  debug(message: string, data?: any) {
    if (!this.isEnabled) return;

    this.console.log(`\n🐛 DEBUG: ${message}`);
    if (data) {
      this.console.log('   Data:', JSON.stringify(data, null, 2));
    }
    this.console.log('───────────────────────────────');
  }
}

export const logger = DebugLogger.getInstance();