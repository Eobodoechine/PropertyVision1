// Save a finished analysis as an example report shown on the demo page.
//
// Usage: node scripts/save-example.mjs <jobId> <example-id> [baseUrl]
//   baseUrl defaults to http://127.0.0.1:3000 (a running copy of the app).
//
// Writes public/examples/<example-id>.json and adds or updates its entry in
// public/examples/index.json.
import fs from 'node:fs';
import path from 'node:path';

const [jobId, exampleId, baseUrl = 'http://127.0.0.1:3000'] = process.argv.slice(2);
if (!jobId || !exampleId || !/^[a-z0-9-]+$/.test(exampleId)) {
  console.error('Usage: node scripts/save-example.mjs <jobId> <example-id: lowercase-with-dashes> [baseUrl]');
  process.exit(2);
}

const res = await fetch(`${baseUrl}/api/analyze/status/${jobId}`);
if (!res.ok) throw new Error(`status ${res.status} for job ${jobId}`);
const job = await res.json();
if (job.status !== 'completed' || !job.result) throw new Error(`job ${jobId} is ${job.status}, not completed`);

const result = job.result;
const arv = result?.arv?.estimate;
if (!result?.subject?.address || typeof arv !== 'number') throw new Error('result has no subject address or ARV');

const dir = path.join(process.cwd(), 'public', 'examples');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `${exampleId}.json`), JSON.stringify(result, null, 2) + '\n');

const indexPath = path.join(dir, 'index.json');
const index = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : [];
const entry = {
  id: exampleId,
  address: result.subject.address,
  arv: Math.round(arv),
  comps: (result.compsUsed || []).length,
  analyzedAt: new Date().toISOString().slice(0, 10),
};
const next = index.filter(e => e.id !== exampleId).concat(entry);
fs.writeFileSync(indexPath, JSON.stringify(next, null, 2) + '\n');
console.log(`saved ${exampleId}: ${entry.address}, ARV $${entry.arv.toLocaleString()}, ${entry.comps} comps`);
