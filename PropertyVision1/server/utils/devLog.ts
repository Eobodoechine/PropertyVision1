// Dev-only in-memory ring buffer logger to expose recent logs via an endpoint
// Never include secrets; only store summarized lines.

const MAX_LINES = 2000;
const buf: string[] = [];

export function addLog(line: string) {
  const ts = new Date().toISOString();
  const entry = `${ts} ${line}`;
  buf.push(entry);
  if (buf.length > MAX_LINES) buf.splice(0, buf.length - MAX_LINES);
}

export function getLast(n: number): string[] {
  if (!Number.isFinite(n) || n <= 0) n = 200;
  return buf.slice(Math.max(0, buf.length - n));
}

export function clearLogs() {
  buf.length = 0;
}

