import 'dotenv/config';
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';

async function getServiceAccountToken(sa: any, scope: string): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = { iss: sa.client_email, scope, aud: sa.token_uri, exp, iat };
  const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
  const unsigned = `${b64(header)}.${b64(claims)}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  const assertion = `${unsigned}.${sign.sign(sa.private_key).toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_')}`;
  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString();
  const u = new URL(sa.token_uri);
  const token: any = await new Promise((resolve, reject) => {
    const req = https.request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body).toString() } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
  if (!token?.access_token) throw new Error('sa-token-failed');
  return token.access_token as string;
}

async function httpsPostJson(url: string, payload: any, headers: Record<string,string>): Promise<any> {
  return await new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = JSON.stringify(payload);
    const req = https.request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body).toString(), ...headers } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const address = process.env.ADDRESS || process.argv.slice(2).join(' ').trim();
  if (!address) throw new Error('Provide ADDRESS');
  const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON;
  if (!saPath) throw new Error('Set GCP_SA_JSON');
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  const projectId = sa.project_id;
  const location = process.env.VERTEX_LOCATION || 'us-central1';
  const model = process.env.VERTEX_MODEL || 'gemini-2.5-pro';
  const token = await getServiceAccountToken(sa, 'https://www.googleapis.com/auth/cloud-platform');
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

  // In this project, multiple tools are not allowed unless all are search tools.
  // So we run function-calling without google_search (note: this is not grounded).
  const tools: any[] = [
    {
      functionDeclarations: [
        {
          name: 'returnPropertyDetails',
          parameters: {
            type: 'OBJECT',
            properties: {
              sqft: { type: 'NUMBER', nullable: true },
              beds: { type: 'NUMBER', nullable: true },
              baths: { type: 'NUMBER', nullable: true },
              yearBuilt: { type: 'NUMBER', nullable: true },
              subdivision: { type: 'STRING', nullable: true },
              lotSize: { type: 'NUMBER', nullable: true }
            }
          }
        },
        {
          name: 'returnComparable',
          parameters: {
            type: 'OBJECT',
            properties: {
              address: { type: 'STRING' },
              sold_price: { type: 'NUMBER' },
              sold_date: { type: 'STRING', nullable: true },
              sqft: { type: 'NUMBER', nullable: true },
              beds: { type: 'NUMBER', nullable: true },
              baths: { type: 'NUMBER', nullable: true },
              year_built: { type: 'NUMBER', nullable: true },
              distance_miles: { type: 'NUMBER', nullable: true },
              ppsf: { type: 'NUMBER', nullable: true },
              source_url: { type: 'STRING', nullable: true },
              source_site: { type: 'STRING', nullable: true },
              condition: { type: 'STRING', nullable: true }
            },
            required: ['address','sold_price']
          }
        }
      ]
    }
  ];

  const prompt = `First, call returnPropertyDetails once for: ${address}. Then call returnComparable up to 6 times for RECENTLY SOLD comps within 3 miles (24 months). Output only function calls.`;

  const payload: any = {
    contents: [{ role: 'user', parts: [{ text: prompt }]}],
    tools,
    generationConfig: { temperature: 0, maxOutputTokens: 1900 }
  };

  const res = await httpsPostJson(url, payload, { Authorization: `Bearer ${token}` });
  console.log('FUNCTIONS FULL:', JSON.stringify(res));
  const parts: any[] = res?.candidates?.[0]?.content?.parts || [];
  const details: any = { sqft: null, beds: null, baths: null, yearBuilt: null, subdivision: null, lotSize: null };
  const comps: any[] = [];
  for (const p of parts) {
    const fc = (p as any).functionCall;
    if (fc?.name === 'returnPropertyDetails') {
      try { Object.assign(details, JSON.parse(fc.args || '{}')); } catch {}
    } else if (fc?.name === 'returnComparable') {
      try { const obj = JSON.parse(fc.args || '{}'); if (obj?.address && obj?.sold_price != null) comps.push(obj); } catch {}
    }
  }

  console.log(JSON.stringify({ details, comps: comps.slice(0, 6) }, null, 2));
}

if (process.env.RUN_CLI === '1' && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error('FUNCTIONS TEST ERROR:', err?.message || err); process.exit(1); });
}

export {};
