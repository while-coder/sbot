import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface LocalConfig {
  sessionId: string;
  agentId: string;
  saverId: string;
  memoryId: string | null;
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
    const cfg = JSON.parse(readFileSync(path, 'utf-8'));
    // Require sessionId — old configs without it are treated as missing
    if (!cfg.sessionId) return null;
    return cfg as LocalConfig;
  } catch {
    return null;
  }
}

export function writeLocalConfig(cfg: LocalConfig): void {
  const dir = join(process.cwd(), CONFIG_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getConfigPath(), JSON.stringify(cfg, null, 2), 'utf-8');
}
