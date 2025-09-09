import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

export async function captureConsoleLogs<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string[] }>{
  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);
  const logs: string[] = [];

  function stamp(kind: 'LOG'|'WARN'|'ERR', args: any[]) {
    const ts = new Date().toISOString();
    const line = `[${ts}] ${kind} ` + args.map(a => {
      if (a instanceof Error) return `${a.message}\n${a.stack || ''}`;
      try { return typeof a === 'string' ? a : JSON.stringify(a); } catch { return String(a); }
    }).join(' ');
    logs.push(line);
    return line;
  }

  console.log = (...args: any[]) => { originalLog(stamp('LOG', args)); };
  console.warn = (...args: any[]) => { originalWarn(stamp('WARN', args)); };
  console.error = (...args: any[]) => { originalError(stamp('ERR', args)); };

  try {
    const result = await fn();
    return { result, logs };
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
}

export function writeAnalysisLog(meta: { address: string; id?: string }, logs: string[]): string | null {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const dir = path.resolve(__dirname, '..', 'logs', 'analysis');
    fs.mkdirSync(dir, { recursive: true });
    const id = meta.id || randomUUID();
    const safeAddr = meta.address
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_\-\.]/g, '')
      .slice(0, 80);
    const filename = `${new Date().toISOString().replace(/[:]/g, '')}--${safeAddr || 'address'}--${id}.log`;
    const full = path.join(dir, filename);
    const header = `# Analysis Log\n# Address: ${meta.address}\n# Time: ${new Date().toISOString()}\n# ID: ${id}\n\n`;
    fs.writeFileSync(full, header + logs.join('\n') + '\n', { encoding: 'utf8' });
    return full;
  } catch {
    return null;
  }
}
