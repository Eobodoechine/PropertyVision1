// Claude provider for PropertyVision, using the Claude API with an API key.
//
// This is the provider for the hosted demo. It has the same contract as the
// CLI provider in claude-cli.js: claudeApiGenerate(opts) resolves to the
// model's text, or '' on any failure, so the pipeline treats a failed call
// exactly like a failed Gemini call used to be treated.
//
// Grounded calls (opts.grounded) get Anthropic's server-side web search tool,
// which replaces Gemini's Google Search grounding.
//
// Env:
//   ANTHROPIC_API_KEY          required
//   CLAUDE_API_MODEL_SEARCH    model for web-search calls (default claude-sonnet-5-5)
//   CLAUDE_API_MODEL_PARSE     model for text->JSON parsing and dedup (default claude-haiku-5-5)
//   CLAUDE_API_MODEL           overrides both tiers when set
//   CLAUDE_API_EFFORT_SEARCH   effort for search calls (default medium)
//   CLAUDE_API_EFFORT_PARSE    effort for parse calls (default low)
//   CLAUDE_API_MAX_SEARCHES    web searches allowed per call (default 6)
//   CLAUDE_API_CONCURRENCY     parallel API calls per process (default 4)
import Anthropic from '@anthropic-ai/sdk';
import pLimit from 'p-limit';
import { jobLog } from './utils/jobLogger';

const SYSTEM_PROMPT =
  'You are a precise real-estate data researcher. Follow the user instructions exactly ' +
  'and return only the requested output, with no preamble.';

// List prices, USD per million tokens, used only for the cost log line.
const PRICES = {
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.1 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, cacheRead: 0.01 },
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2 },
};
const WEB_SEARCH_USD = 0.01; // $10 per 1,000 searches

// Server-side refusal fallback. It is sent only on Sonnet 5.5 calls; Haiku has
// no server-side fallback. If the API ever rejects the parameter, it is turned
// off for the rest of the process instead of failing every search.
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
let fallbacksEnabled = (process.env.CLAUDE_API_FALLBACKS || 'on').toLowerCase() !== 'off';

let client = null;
function getClient() {
  if (!client) {
    client = new Anthropic({
      maxRetries: Number(process.env.CLAUDE_API_MAX_RETRIES || 6), // 429/5xx back off and retry
    });
  }
  return client;
}

const limit = pLimit(Math.max(1, Number(process.env.CLAUDE_API_CONCURRENCY || 4)));

export function pickApiModel(opts) {
  if (process.env.CLAUDE_API_MODEL) return process.env.CLAUDE_API_MODEL;
  return opts.grounded
    ? (process.env.CLAUDE_API_MODEL_SEARCH || 'claude-sonnet-5-5')
    : (process.env.CLAUDE_API_MODEL_PARSE || 'claude-haiku-5-5');
}

const costStats = { calls: 0, usd: 0, searches: 0 };
export function getClaudeApiCostStats() { return { ...costStats }; }

function estimateUsd(model, usage) {
  const p = PRICES[model] || PRICES['claude-sonnet-5-5'];
  const inTok = (usage?.input_tokens || 0) + (usage?.cache_creation_input_tokens || 0);
  const cacheRead = usage?.cache_read_input_tokens || 0;
  const outTok = usage?.output_tokens || 0;
  const searches = usage?.server_tool_use?.web_search_requests || 0;
  return {
    usd: (inTok * p.in + cacheRead * p.cacheRead + outTok * p.out) / 1e6 + searches * WEB_SEARCH_USD,
    searches,
  };
}

// The answer is the run of text blocks after the last tool step. Text written
// before or between searches ("Let me search for...") is not part of it.
// Thinking blocks are skipped. Exported for tests.
export function extractFinalText(content) {
  const blocks = Array.isArray(content) ? content : [];
  let lastToolIdx = -1;
  blocks.forEach((b, i) => {
    if (b && b.type !== 'text' && b.type !== 'thinking' && b.type !== 'redacted_thinking') lastToolIdx = i;
  });
  return blocks
    .slice(lastToolIdx + 1)
    .filter(b => b && b.type === 'text')
    .map(b => b.text || '')
    .join('')
    .trim();
}

// Pull the JSON out of a reply: drop code fences, then any prose around the
// outermost object or array. Exported for tests.
export function extractJson(text) {
  let t = String(text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  if (t.startsWith('{') || t.startsWith('[')) return t;
  const starts = [t.indexOf('{'), t.indexOf('[')].filter(i => i >= 0);
  if (!starts.length) return t;
  const start = Math.min(...starts);
  const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  return end > start ? t.slice(start, end + 1) : t;
}

async function createMessage(params, useFallbacks, timeoutMs) {
  const c = getClient();
  if (useFallbacks) {
    const stream = c.beta.messages.stream(
      { ...params, betas: [FALLBACK_BETA], fallbacks: 'default' },
      { timeout: timeoutMs },
    );
    return stream.finalMessage();
  }
  return c.messages.stream(params, { timeout: timeoutMs }).finalMessage();
}

export async function claudeApiGenerate(opts) {
  return limit(() => generate(opts));
}

async function generate(opts) {
  const caller = opts.caller || 'unknown';
  const started = Date.now();
  const model = pickApiModel(opts);
  const wantJson = !!(opts.json || opts.responseSchema);

  let prompt = opts.prompt || '';
  if (opts.grounded) {
    prompt = 'Use web search to find current, authoritative data before answering.\n\n' + prompt;
  }
  if (wantJson) {
    prompt += '\n\nReturn ONLY valid JSON, no prose and no code fences.';
    if (opts.responseSchema) prompt += '\nThe JSON must match this schema:\n' + JSON.stringify(opts.responseSchema);
  }

  const effort = opts.grounded
    ? (process.env.CLAUDE_API_EFFORT_SEARCH || 'medium')
    : (process.env.CLAUDE_API_EFFORT_PARSE || 'low');
  const params = {
    model,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    output_config: { effort },
    messages: [{ role: 'user', content: prompt }],
    ...(opts.grounded
      ? { tools: [{ type: 'web_search_20260209', name: 'web_search',
          max_uses: Number(process.env.CLAUDE_API_MAX_SEARCHES || 6) }] }
      : {}),
  };
  const timeoutMs = Math.max(opts.timeoutMs || 0, 240000); // web search needs longer than Gemini did

  jobLog(`📞 CLAUDE_API_CALL from ${caller}, model=${model}, grounded=${!!opts.grounded}, json=${wantJson}`);
  let callUsd = 0;
  try {
    let response;
    // A long server-side search turn can pause; send it back so the server resumes it.
    for (let round = 0; round < 4; round++) {
      const useFallbacks = fallbacksEnabled && model === 'claude-sonnet-5-5';
      try {
        response = await createMessage(params, useFallbacks, timeoutMs);
      } catch (e) {
        if (useFallbacks && e instanceof Anthropic.BadRequestError) {
          // A 400 can mean the fallbacks parameter was refused, or something else
          // entirely (no credit, bad model). Retry once without it; switch fallbacks
          // off for the process only if that retry succeeds.
          response = await createMessage(params, false, timeoutMs);
          fallbacksEnabled = false;
          jobLog(`⚠️ CLAUDE_API: request with refusal fallbacks got 400 but succeeded without them; fallbacks off for this process`);
        } else {
          throw e;
        }
      }
      const { usd, searches } = estimateUsd(model, response.usage);
      callUsd += usd;
      costStats.searches += searches;
      if (response.stop_reason !== 'pause_turn') break;
      params.messages = [...params.messages, { role: 'assistant', content: response.content }];
    }
    costStats.calls++;
    costStats.usd += callUsd;
    jobLog(`💲 CLAUDE_API_COST: caller=${caller}, model=${model}, call=$${callUsd.toFixed(4)}, ` +
      `process_total=$${costStats.usd.toFixed(4)} over ${costStats.calls} calls, ${costStats.searches} searches (list price)`);

    if (response.stop_reason === 'refusal') {
      jobLog(`❌ CLAUDE_API_REFUSAL: caller=${caller}, category=${response.stop_details?.category ?? 'n/a'}`);
      return '';
    }
    let text = extractFinalText(response.content);
    if (wantJson) text = extractJson(text);
    jobLog(`✅ CLAUDE_API_SUCCESS: caller=${caller}, ms=${Date.now() - started}, stop=${response.stop_reason}, textLength=${text.length}`);
    return text;
  } catch (e) {
    const kind = e instanceof Anthropic.AuthenticationError ? 'auth'
      : e instanceof Anthropic.RateLimitError ? 'rate_limit'
      : e instanceof Anthropic.APIError ? `api_${e.status}`
      : 'network_or_timeout';
    jobLog(`❌ CLAUDE_API_FAILED: caller=${caller}, kind=${kind}, ms=${Date.now() - started}, error=${String(e?.message).slice(0, 300)}`);
    return '';
  }
}
