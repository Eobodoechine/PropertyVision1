import 'dotenv/config';
import https from 'https';

export type FreeformResult = {
  text: string;
  response: any;
};

async function httpsPostJson(url: string, payload: any, headers: Record<string, string>, timeoutMs = 60000): Promise<any> {
  return await new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = JSON.stringify(payload);
    const req = https.request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body).toString(), ...headers } }, (res) => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { try { req.destroy(new Error('timeout')); } catch {}; reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

export async function groundedFreeform(opts: {
  accessToken: string;
  projectId: string;
  location: string;
  model: string;
  prompt: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
}): Promise<FreeformResult> {
  const url = `https://${opts.location}-aiplatform.googleapis.com/v1/projects/${opts.projectId}/locations/${opts.location}/publishers/google/models/${opts.model}:generateContent`;
  const payload: any = {
    contents: [{ role: 'user', parts: [{ text: opts.prompt }]}],
    generationConfig: { temperature: 0, maxOutputTokens: opts.maxOutputTokens ?? 1500 },
    tools: [{ google_search: {} } as any]
  };
  const res = await httpsPostJson(url, payload, { Authorization: `Bearer ${opts.accessToken}` }, opts.timeoutMs ?? 90000);
  const parts: any[] = res?.candidates?.[0]?.content?.parts || [];
  const text = parts.map((p: any) => p?.text || '').join('');
  return { text, response: res };
}

