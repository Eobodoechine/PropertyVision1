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

  // Start HTTP server for Cloud Run health checks AND Pub/Sub push messages
  const PORT = parseInt(process.env.PORT || '8080', 10);
  const server = http.createServer(async (req, res) => {
    // Health check endpoints
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
      return;
    }

    // Pub/Sub push endpoint
    if (req.url === '/api/worker/process' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', async () => {
        try {
          const pubsubMessage = JSON.parse(body);

          // Validate Pub/Sub message format
          if (!pubsubMessage.message || !pubsubMessage.message.data) {
            jobLog('❌ Invalid Pub/Sub message format');
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid Pub/Sub message format' }));
            return;
          }

          // Parse job data from base64-encoded message
          const messageData = Buffer.from(pubsubMessage.message.data, 'base64').toString('utf-8');
          const jobData = JSON.parse(messageData);
          const pubsubMessageId = pubsubMessage.message.messageId;

          jobLog(`📬 Received Pub/Sub message ${pubsubMessageId} for job ${jobData.jobId}`);
          jobLog(`   Address: ${jobData.address}`);

          // Process job
          await jobQueue.processJobFromPubSub(jobData, pubsubMessageId);

          // Acknowledge message with 204 No Content (standard for Pub/Sub ack)
          res.writeHead(204);
          res.end();
        } catch (error: any) {
          jobLog(`❌ Error processing Pub/Sub message:`, error.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Job processing failed', message: error.message }));
        }
      });
      return;
    }

    // 404 for all other routes
    res.writeHead(404);
    res.end('Not Found');
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

  // Determine processing mode: Pub/Sub (HTTP-triggered) or Redis Streams (polling)
  const usePubSub = process.env.USE_PUBSUB === 'true';

  if (usePubSub) {
    jobLog('📢 Pub/Sub mode enabled - HTTP endpoint ready for push messages');
    jobLog('   Worker will receive jobs via /api/worker/process endpoint');
    jobLog('   Worker will scale to zero when idle (no active HTTP requests)');
    // Don't call jobQueue.processJobs() - wait for HTTP requests from Pub/Sub push subscription
  } else {
    jobLog('📜 Redis Stream mode enabled - starting polling');
    jobLog('   Worker will continuously poll Redis Streams for jobs');
    // Start processing jobs from Redis Streams (non-blocking - runs in background)
    jobQueue.processJobs().catch((error) => {
      console.error('❌ Job processing error:', error);
    });
  }
}

startWorker().catch((error) => {
  console.error('❌ Worker failed:', error);
  process.exit(1);
});
