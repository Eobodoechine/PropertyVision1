export async function register() {
  // Only run worker in staging (not production)
  // Production has a dedicated worker service
  const isStaging = process.env.GOOGLE_CLOUD_PROJECT_ID === 'agile-device-472202-i8' &&
                    !process.env.IS_PRODUCTION;

  if (process.env.NEXT_RUNTIME === 'nodejs' && isStaging) {
    // Import and start worker for staging
    const { getJobQueue } = await import('./src/server/utils/jobQueue');

    console.log('🔧 Instrumentation (STAGING): Initializing worker...');
    const jobQueue = getJobQueue();

    // Start processing jobs in the background
    jobQueue.processJobs().catch((error) => {
      console.error('❌ Worker error in instrumentation:', error);
    });

    console.log('✅ Instrumentation (STAGING): Worker initialized and running');
  }
}
