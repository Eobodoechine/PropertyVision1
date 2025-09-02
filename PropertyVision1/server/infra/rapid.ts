
// RapidAPI request logging utility
import { getRapidApiKey } from '../utils/rapidKey';
import { addLog } from '../utils/devLog';

interface RapidAPIResponse {
  status: number;
  headers: any;
  data: any;
}

export async function loggedFetch(url: string, options: any = {}): Promise<Response> {
  const apiKey = getRapidApiKey();
  
  if (!apiKey) {
    throw new Error('RapidAPI key not configured');
  }

  const headers = {
    'Content-Type': 'application/json',
    'X-RapidAPI-Key': apiKey,
    'X-RapidAPI-Host': 'realty-in-us.p.rapidapi.com',
    ...options.headers
  };

  const requestOptions = {
    ...options,
    headers
  };

  const startTime = Date.now();
  const method = options.method || 'GET';
  const showKey = process.env.NODE_ENV !== 'production' && process.env.DEBUG_RAPID !== '0' && process.env.DEBUG_RAPID !== 'false';
  console.log(`[RAPIDAPI] REQUEST: ${method} ${url}`);
  try { addLog(`[RAPIDAPI] ${method} ${url}`); } catch {}
  if (showKey) {
    console.log(`[RAPIDAPI] API Key visible: ${apiKey ? 'YES' : 'NO'} (${apiKey ? apiKey.substring(0, 8) + '...' : 'MISSING'})`);
  }

  // Retry on 429/5xx with simple backoff and 20s timeout per attempt
  const maxRetries = typeof options.maxRetries === 'number' ? options.maxRetries : 2;
  const baseDelay = 400; // ms
  let lastErr: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const attemptStart = Date.now();
    const controller = new AbortController();
    const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 20000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...requestOptions, signal: controller.signal } as any);
      clearTimeout(timeout);

      const duration = Date.now() - attemptStart;
      console.log(`[RAPIDAPI] RESPONSE: ${response.status} ${response.statusText} (${duration}ms, attempt ${attempt + 1})`);
      const rlRemain = response.headers.get('x-ratelimit-remaining') || 'N/A';
      const rlReset = response.headers.get('x-ratelimit-reset') || 'N/A';
      console.log(`[RAPIDAPI] Request-ID: ${response.headers.get('x-request-id') || 'N/A'}`);
      console.log(`[RAPIDAPI] Rate Limit Remaining: ${rlRemain}`);
      console.log(`[RAPIDAPI] Rate Limit Reset: ${rlReset}`);
      try { addLog(`[RAPIDAPI] RESP ${response.status} ${response.statusText} (${duration}ms) rem=${rlRemain} reset=${rlReset}`); } catch {}

      if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
        if (attempt < maxRetries) {
          const delayFromHeader = Number(rlReset) && Number(rlRemain) === 0 ? Number(rlReset) * 1000 : 0;
          const backoff = delayFromHeader || baseDelay * Math.pow(2, attempt);
          console.log(`[RAPIDAPI] Retrying in ${backoff}ms due to status ${response.status}...`);
          try { addLog(`[RAPIDAPI] retry ${attempt + 1} in ${backoff}ms for ${url}`); } catch {}
          await new Promise(r => setTimeout(r, backoff));
          continue;
        }
      }
      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastErr = error;
      const duration = Date.now() - attemptStart;
      console.log(`[RAPIDAPI] ERROR attempt ${attempt + 1}: ${error} (${duration}ms)`);
      try { addLog(`[RAPIDAPI] ERROR attempt ${attempt + 1}: ${String(error)} (${duration}ms)`); } catch {}
      if (attempt < maxRetries) {
        const backoff = baseDelay * Math.pow(2, attempt);
        console.log(`[RAPIDAPI] Retrying in ${backoff}ms after error...`);
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }
      throw error;
    }
  }

  throw lastErr || new Error('Unknown RapidAPI error');
}
