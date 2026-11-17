// Offline checks for the Claude API provider's response handling.
// Run: npx tsx scripts/test-claude-api-parsing.ts
import assert from 'node:assert/strict';
import { extractFinalText, extractJson, pickApiModel } from '../src/server/claude-api.js';

// A web-search reply: narration, a search, results, thinking, then the answer
// split across several text blocks (citations split text this way).
const searchReply = [
  { type: 'thinking', thinking: '' },
  { type: 'text', text: "I'll search for recent sales." },
  { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'sold homes 30344' } },
  { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [{ type: 'web_search_result', url: 'https://x', title: 't' }] },
  { type: 'thinking', thinking: '' },
  { type: 'text', text: '[{"address":"1 A St",' },
  { type: 'text', text: '"price":325000}]', citations: [] },
];
assert.equal(extractFinalText(searchReply), '[{"address":"1 A St","price":325000}]');

// No tools at all: every text block is the answer.
assert.equal(extractFinalText([{ type: 'text', text: 'hello ' }, { type: 'text', text: 'world' }]), 'hello world');

// Empty or malformed content never throws.
assert.equal(extractFinalText([]), '');
assert.equal(extractFinalText(undefined as any), '');

// JSON extraction: fences, surrounding prose, bare JSON.
assert.equal(extractJson('```json\n{"a":1}\n```'), '{"a":1}');
assert.equal(extractJson('Here you go: {"a":[1,2]} hope that helps'), '{"a":[1,2]}');
assert.equal(extractJson('[1,2,3]'), '[1,2,3]');
assert.equal(JSON.parse(extractJson('Result:\n[{"x":1},{"y":2}]\nDone.'))[1].y, 2);

// Model tiers.
delete process.env.CLAUDE_API_MODEL;
assert.equal(pickApiModel({ grounded: true }), 'claude-sonnet-5-5');
assert.equal(pickApiModel({ grounded: false }), 'claude-haiku-5-5');

console.log('claude-api parsing checks: all passed');
