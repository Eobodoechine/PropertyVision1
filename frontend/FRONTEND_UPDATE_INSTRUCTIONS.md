# Frontend Polling Implementation

Update `src/app/page.tsx` - replace the `analyzeProperty` function:

```typescript
async function analyzeProperty(address: string): Promise<PropertyAnalysisResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 min timeout

  try {
    // Start async job
    const response = await fetch(`${API_BASE_URL}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error('Failed to start analysis');
    }

    const { jobId } = await response.json();

    // Poll for results with backoff
    let pollInterval = 3000; // Start at 3 seconds
    return await new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          const statusRes = await fetch(`${API_BASE_URL}/api/analyze/status/${jobId}`);

          if (!statusRes.ok) {
            reject(new Error('Failed to get job status'));
            return;
          }

          const status = await statusRes.json();

          if (status.status === 'completed') {
            resolve(status.result);
          } else if (status.status === 'failed') {
            reject(new Error(status.error || 'Analysis failed'));
          } else {
            // Update progress
            setProgress(status.progress || 0);

            // Backoff: 3s → 5s → 8s → 13s (cap at 15s)
            pollInterval = Math.min(pollInterval + 2000, 15000);
            setTimeout(poll, pollInterval);
          }
        } catch (error) {
          reject(error);
        }
      };

      poll();
    });
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}
```
