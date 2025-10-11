import { getJobQueue } from './utils/jobQueue';
import { jobLog } from './utils/jobLogger';
import http from 'http';

async function startWorker() {
  if (process.env.RUN_WORKER !== 'true') {
    jobLog('⏭️  Worker disabled (RUN_WORKER != true)');
    return;
  }

  jobLog('🚀 Starting job worker...');
  const jobQueue = getJobQueue();

  // Start HTTP server for Cloud Run health checks (required for Cloud Run Services)
  const PORT = parseInt(process.env.PORT || '8080', 10);
  const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  // Start HTTP server and wait for it to be ready
  await new Promise<void>((resolve) => {
    server.listen(PORT, '0.0.0.0', () => {
      jobLog(`✅ Worker health check server listening on 0.0.0.0:${PORT}`);
      resolve();
    });
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    jobLog('📪 SIGTERM received, stopping worker...');
    server.close();
    await jobQueue.stop();
    process.exit(0);
  });

  // Start processing jobs (non-blocking - runs in background)
  jobQueue.processJobs().catch((error) => {
    console.error('❌ Job processing error:', error);
  });
}

startWorker().catch((error) => {
  console.error('❌ Worker failed:', error);
  process.exit(1);
});
