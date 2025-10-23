import 'dotenv/config';
import fs from 'fs';
import { buildStrategyRegistry, buildContext, getServiceAccountToken, runWithLimit, scoreTargets, vertexGenerateRaw, buildUserAnalystPrompt } from './vertex-bakeoff-shared.js';

type Result = { name: string; strict: boolean; hits: string[]; missing: string[]; text: string; error?: string };

async function runGroup(groupName: string, strategyNames: string[], ctx: any, concurrency: number, token: string, location: string, projectId: string, model: string, targets: string[]): Promise<Result[]> {
  const reg = buildStrategyRegistry();
  const strategies = strategyNames.map(n => reg[n]).filter(Boolean);
  const tasks = strategies.map((s) => async () => {
    try {
      const prompt = s.prompt(ctx);
      const text = await vertexGenerateRaw({ token, location, projectId, model, prompt });
      const scored = scoreTargets(text || '', targets);
      return { name: s.name, strict: !!s.strict, hits: scored.hits, missing: scored.missing, text: text || '' };
    } catch (err: any) {
      return { name: s?.name || 'unknown', strict: !!s?.strict, hits: [], missing: targets.slice(), text: '', error: err?.message || String(err) };
    }
  });
  const res = await runWithLimit<Result>(concurrency, tasks);
  fs.writeFileSync(`testing/bakeoff-results-${groupName}.json`, JSON.stringify(res, null, 2));
  return res;
}

async function main() {
  const address = process.env.ADDRESS || '185 Jordan Pl, Fayetteville, GA 30215';
  const radius = Number(process.env.RADIUS || '3');
  const months = Number(process.env.MONTHS || '18');
  const concurrency = Number(process.env.CONCURRENCY || '6');
  const targets = (process.env.TARGETS || '110 bailey ct,385 stoneridge way,560 ridgemont,12558 lakeside pkwy,280 ridgemont,125 winter valley')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

  const ctx = await buildContext(address, radius, months);
  console.log('🧩 Context:', ctx);

  // SA + endpoint
  const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON as string;
  if (!saPath || !fs.existsSync(saPath)) throw new Error('GCP_SA_JSON is required');
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  const projectId = sa.project_id;
  const location = process.env.VERTEX_LOCATION || 'us-central1';
  const model = process.env.VERTEX_MODEL || 'gemini-2.5-pro';
  const token = await getServiceAccountToken(sa, 'https://www.googleapis.com/auth/cloud-platform');

  // Define groups of strategies (6 each)
  const groups: Record<string, string[]> = {
    A: [
      'subdivision-default-20',
      'subdivision-strict-20-distance',
      'street-cluster-strict-1mi',
      'broader-strict-20',
      'domain-allowlist-strict',
      'subject-card-subdivision-strict'
    ],
    B: [
      'zip-city-strict',
      'ring-1mi-strict',
      'ring-2mi-strict',
      'ring-3mi-strict',
      'renovated-terms-strict-20',
      'table-default-20'
    ],
    C: [
      'street-cluster-strict-2mi',
      'subdivision-default-30',
      'broader-strict-30',
      'zip-city-default-20',
      'price-band-strict',
      'sqft-cap-strict'
    ],
    D: [
      'analyst-default',
      'analyst-subdivision-cluster',
      'street-cluster-strict-2mi',
      'street-cluster-strict-1mi',
      'subdivision-default-20',
      'broader-strict-20'
    ],
    E: [
      'street-cluster-no-targets-1mi',
      'street-cluster-no-targets-2mi'
    ],
    F: [
      // User-specified analyst prompt and a few best strict variants for direct comparison
      'analyst-user',
      'street-cluster-strict-1mi',
      'street-cluster-strict-2mi',
      'subdivision-default-30',
      'ring-2mi-strict',
      'subject-card-subdivision-strict'
    ]
  };

  const summaries: Record<string, Result[]> = {};

  for (const [groupName, stratNames] of Object.entries(groups)) {
    console.log(`\n🚀 Running group ${groupName} (${stratNames.length} strategies) with concurrency=${concurrency}...`);
    // Inject analyst-user dynamically
    if (groupName === 'F') {
      const reg = buildStrategyRegistry();
      (reg as any)['analyst-user'] = {
        name: 'analyst-user',
        strict: false,
        prompt: (c: any) => buildUserAnalystPrompt(c)
      };
      // Run manually for F, since runGroup fetches from registry internally
      const strategies = stratNames.map(n => (reg as any)[n]).filter(Boolean);
      const tasks = strategies.map((s: any) => async () => {
        try {
          const prompt = s.prompt(ctx);
          const text = await vertexGenerateRaw({ token, location, projectId, model, prompt });
          const scored = scoreTargets(text || '', targets);
          return { name: s.name, strict: !!s.strict, hits: scored.hits, missing: scored.missing, text: text || '' };
        } catch (err: any) {
          return { name: s?.name || 'unknown', strict: !!s?.strict, hits: [], missing: targets.slice(), text: '', error: err?.message || String(err) };
        }
      });
      const resF = await runWithLimit<any>(concurrency, tasks);
      fs.writeFileSync(`testing/bakeoff-results-${groupName}.json`, JSON.stringify(resF, null, 2));
      summaries[groupName] = resF;
      const groupHitsF = resF.map((r: any) => ({ name: r.name, hits: r.hits.length }));
      console.log(`\n📊 Group ${groupName} summary:`);
      groupHitsF.forEach((g: any) => console.log(`- ${g.name}: hits=${g.hits}`));
      continue;
    }
    const res = await runGroup(groupName, stratNames, ctx, concurrency, token, location, projectId, model, targets);
    summaries[groupName] = res;
    const groupHits = res.map(r => ({ name: r.name, hits: r.hits.length }));
    console.log(`\n📊 Group ${groupName} summary:`);
    groupHits.forEach(g => console.log(`- ${g.name}: hits=${g.hits}`));
  }

  // Combined analysis
  console.log(`\n🏁 Combined summary (all groups):`);
  const all = Object.values(summaries).flat();
  all.sort((a, b) => (b.hits?.length || 0) - (a.hits?.length || 0));
  all.slice(0, 10).forEach((r, i) => {
    console.log(`${i + 1}. ${r.name}${r.strict ? ' (strict)' : ''} — hits=${r.hits.length} [${r.hits.join(', ')}]`);
  });
}

main().catch(err => { console.error('Runner failed:', err?.message || err); process.exit(1); });
