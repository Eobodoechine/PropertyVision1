
// RapidAPI request logging utility
import { getRapidApiKey } from '../utils/rapidKey';

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
  console.log(`[RAPIDAPI] REQUEST: ${options.method || 'GET'} ${url}`);
  console.log(`[RAPIDAPI] API Key visible: ${apiKey ? 'YES' : 'NO'} (${apiKey ? apiKey.substring(0, 8) + '...' : 'MISSING'})`);

  try {
    const response = await fetch(url, requestOptions);
    const duration = Date.now() - startTime;
    
    console.log(`[RAPIDAPI] RESPONSE: ${response.status} ${response.statusText} (${duration}ms)`);
    console.log(`[RAPIDAPI] Request-ID: ${response.headers.get('x-request-id') || 'N/A'}`);
    console.log(`[RAPIDAPI] Rate Limit Remaining: ${response.headers.get('x-ratelimit-remaining') || 'N/A'}`);
    console.log(`[RAPIDAPI] Rate Limit Reset: ${response.headers.get('x-ratelimit-reset') || 'N/A'}`);
    
    return response;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.log(`[RAPIDAPI] ERROR: ${error} (${duration}ms)`);
    throw error;
  }
}
