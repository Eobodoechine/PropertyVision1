import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';

function safeAssign(env: Record<string, string>) {
  for (const [k, v] of Object.entries(env)) {
    if (typeof process.env[k] === 'undefined' || process.env[k] === '') {
      process.env[k] = v;
    }
  }
}

function loadFileIfExists(filePath: string) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = dotenv.parse(content);
      safeAssign(parsed);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

function findAppRoot(): string {
  try {
    const thisFile = fileURLToPath(import.meta.url);
    const here = path.dirname(thisFile);

    const candidates = [
      path.resolve(here, '..', '..'), // dev: server/utils -> app root
      path.resolve(here, '..'),       // bundle: dist -> app root
      process.cwd(),
    ];
    for (const c of candidates) {
      try {
        if (fs.existsSync(path.join(c, 'package.json'))) return c;
      } catch {}
    }
  } catch {}
  return process.cwd();
}

export function loadAppEnv() {
  // Do not override variables that are already set in the environment
  const appRoot = findAppRoot();

  // 1) .env.local (gitignored)
  loadFileIfExists(path.join(appRoot, '.env.local'));

  // 2) .env (may exist locally; repo keeps .env.example as template)
  loadFileIfExists(path.join(appRoot, '.env'));

  // 3) User config (~/.config/propertyvision1/.env)
  const userCfg = path.join(os.homedir(), '.config', 'propertyvision1', '.env');
  loadFileIfExists(userCfg);
}

