import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface LocalConfig {
  sessionId: string;
  baseUrl: string;
  agentName: string;
  saverName: string;
  memoryName: string | null;
}

const CONFIG_DIR = '.sbot';
const CONFIG_FILE = 'settings.json';

function getConfigPath(): string {
  return join(process.cwd(), CONFIG_DIR, CONFIG_FILE);
}

export function readLocalConfig(): LocalConfig | null {
  const path = getConfigPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as LocalConfig;
  } catch {
    return null;
  }
}

export function writeLocalConfig(cfg: LocalConfig): void {
  const dir = join(process.cwd(), CONFIG_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getConfigPath(), JSON.stringify(cfg, null, 2), 'utf-8');
}
