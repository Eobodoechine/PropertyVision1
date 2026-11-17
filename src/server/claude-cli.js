// Claude provider for PropertyVision, using the local `claude` CLI.
//
// It replaces the Vertex/Gemini HTTP calls. The CLI signs in with the
// Claude subscription logged in on this machine, so no API key is needed.
// It only works where `claude` is installed and logged in, not on Cloud Run.
//
// Provider switch (LLM_PROVIDER):
//   claude (default)  Claude API when ANTHROPIC_API_KEY is set, else the local CLI
//   claude-api        always the Claude API (claude-api.js); use this when hosted
//   claude-cli        always the local CLI on the logged-in subscription (your own Mac only)
//   vertex            the old Google Vertex/Gemini path
// Optional env:
//   CLAUDE_BIN    path to the claude binary (default: `claude` on PATH, else
//                 the newest copy bundled with the Claude desktop app)
//   CLAUDE_MODEL_SEARCH  model for web-search (grounded) calls (default: sonnet)
//   CLAUDE_MODEL_PARSE   model for text->JSON parsing and dedup (default: haiku)
//   CLAUDE_MODEL         overrides both tiers when set
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { jobLog } from './utils/jobLogger';
import { claudeApiGenerate } from './claude-api.js';

function provider() {
  return (process.env.LLM_PROVIDER || 'claude').toLowerCase();
}

export function useClaude() {
  return ['claude', 'claude-api', 'claude-cli'].includes(provider());
}

export function useClaudeApi() {
  const p = provider();
  return p === 'claude-api' || (p === 'claude' && !!process.env.ANTHROPIC_API_KEY);
}

// Same contract as vertexGenerate: resolves to the model's text, or '' on any failure.
export async function claudeGenerate(opts) {
  return useClaudeApi() ? claudeApiGenerate(opts) : cliGenerate(opts);
}

let cachedBin = null;
export function resolveClaudeBin() {
  if (cachedBin) return cachedBin;
  if (process.env.CLAUDE_BIN) return (cachedBin = process.env.CLAUDE_BIN);
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const p = path.join(dir, 'claude');
    if (dir && fs.existsSync(p)) return (cachedBin = p);
  }
  // Fallback: binary bundled with the Claude desktop app (newest version).
  const root = path.join(os.homedir(), 'Library/Application Support/Claude/claude-code');
  try {
    const versions = fs.readdirSync(root).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })).reverse();
    for (const v of versions) {
      for (const h of fs.readdirSync(path.join(root, v))) {
        const p = path.join(root, v, h, 'claude.app/Contents/MacOS/claude');
        if (fs.existsSync(p)) return (cachedBin = p);
      }
    }
  } catch { /* not installed there */ }
  throw new Error('claude CLI not found: install Claude Code or set CLAUDE_BIN');
}

const SYSTEM_PROMPT =
  'You are a precise real-estate data researcher. Follow the user instructions exactly ' +
  'and return only the requested output, with no preamble.';

// Model tiers. Grounded calls search the web and weigh conflicting listings,
// so they get Sonnet. Non-grounded calls only reshape text the pipeline already
// has (parse to JSON, dedupe addresses), so Haiku is enough.
export function pickModel(opts) {
  if (process.env.CLAUDE_MODEL) return process.env.CLAUDE_MODEL;
  return opts.grounded
    ? (process.env.CLAUDE_MODEL_SEARCH || 'sonnet')
    : (process.env.CLAUDE_MODEL_PARSE || 'haiku');
}

// Cost tracking. On a subscription nothing is billed per call: total_cost_usd
// is the CLI's list-price equivalent. It is still the best gauge of how fast a
// job uses up the plan's usage limits.
const costStats = { calls: 0, usd: 0, byCaller: {} };
export function getClaudeCostStats() { return JSON.parse(JSON.stringify(costStats)); }
function recordCost(caller, model, usd) {
  costStats.calls++;
  costStats.usd += usd;
  const k = `${caller}|${model}`;
  const c = (costStats.byCaller[k] ||= { calls: 0, usd: 0 });
  c.calls++;
  c.usd += usd;
}

function stripFences(text) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return m ? m[1].trim() : text.trim();
}

async function cliGenerate(opts) {
  const caller = opts.caller || 'unknown';
  const started = Date.now();
  let prompt = opts.prompt || '';
  if (opts.grounded) {
    prompt = 'Use web search to find current, authoritative data before answering.\n\n' + prompt;
  }
  if (opts.json || opts.responseSchema) {
    prompt += '\n\nReturn ONLY valid JSON, no prose and no code fences.';
    if (opts.responseSchema) prompt += '\nThe JSON must match this schema:\n' + JSON.stringify(opts.responseSchema);
  }

  const tools = opts.grounded ? 'WebSearch,WebFetch' : '';
  const model = pickModel(opts);
  const args = [
    '-p', '--output-format', 'json',
    '--model', model,
    '--system-prompt', SYSTEM_PROMPT,
    '--tools', tools,
    ...(tools ? ['--allowedTools', tools] : []),
    '--setting-sources', '',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--permission-mode', 'dontAsk',
  ];

  // Subscription auth: drop any API key so the CLI uses the logged-in account.
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-claude-'));

  jobLog(`📞 CLAUDE_CALL from ${caller}, model=${model}, grounded=${!!opts.grounded}, json=${!!opts.json}`);
  try {
    const stdout = await new Promise((resolve, reject) => {
      const child = spawn(resolveClaudeBin(), args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '', err = '';
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`timeout after ${opts.timeoutMs}ms`)); },
        Math.max(opts.timeoutMs || 0, 180000)); // web search needs longer than Gemini did
      child.stdout.on('data', d => { out += d; });
      child.stderr.on('data', d => { err += d; });
      child.on('error', e => { clearTimeout(timer); reject(e); });
      child.on('close', code => {
        clearTimeout(timer);
        if (code !== 0 && !out) reject(new Error(`claude exited ${code}: ${err.slice(0, 300)}`));
        else resolve(out);
      });
      child.stdin.end(prompt); // prompt via stdin: no argv length limit
    });
    const res = JSON.parse(stdout);
    const usd = Number(res.total_cost_usd) || 0;
    recordCost(caller, model, usd);
    jobLog(`💲 CLAUDE_COST: caller=${caller}, model=${model}, call=$${usd.toFixed(4)}, ` +
      `run_total=$${costStats.usd.toFixed(4)} over ${costStats.calls} calls (list-price equivalent)`);
    if (res.is_error) {
      jobLog(`❌ CLAUDE_ERROR: caller=${caller}, subtype=${res.subtype}, result=${String(res.result).slice(0, 200)}`);
      return '';
    }
    let text = String(res.result || '');
    if (opts.json || opts.responseSchema) text = stripFences(text);
    jobLog(`✅ CLAUDE_SUCCESS: caller=${caller}, ms=${Date.now() - started}, textLength=${text.length}`);
    return text;
  } catch (e) {
    jobLog(`❌ CLAUDE_CALL_FAILED: caller=${caller}, ms=${Date.now() - started}, error=${e.message}`);
    return '';
  } finally {
    fs.rm(cwd, { recursive: true, force: true }, () => {});
  }
}
