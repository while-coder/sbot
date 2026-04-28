import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface WorkPathEntry {
  path: string;
  alias: string;
}

export interface RemoteEntry {
  name: string;
  host: string;
  port: number;
  workPaths: WorkPathEntry[];
}

export interface CliSettings {
  remotes: RemoteEntry[];
}

const CLI_DIR = join(homedir(), '.sbot-cli');
const SETTINGS_PATH = join(CLI_DIR, 'settings.json');

export function loadCliSettings(): CliSettings {
  try {
    if (existsSync(SETTINGS_PATH)) {
      const raw = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
      return { remotes: Array.isArray(raw.remotes) ? raw.remotes : [] };
    }
  } catch { /* corrupt file — treat as empty */ }
  return { remotes: [] };
}

function saveCliSettings(settings: CliSettings): void {
  if (!existsSync(CLI_DIR)) mkdirSync(CLI_DIR, { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
}

export function addRemote(name: string, host: string, port: number): CliSettings {
  const settings = loadCliSettings();
  settings.remotes.push({ name, host, port, workPaths: [] });
  saveCliSettings(settings);
  return settings;
}

export function updateRemote(remoteIndex: number, patch: Partial<Pick<RemoteEntry, 'name' | 'host' | 'port'>>): CliSettings {
  const settings = loadCliSettings();
  const remote = settings.remotes[remoteIndex];
  if (!remote) throw new Error(`Remote index ${remoteIndex} out of bounds`);
  if (patch.name !== undefined) remote.name = patch.name;
  if (patch.host !== undefined) remote.host = patch.host;
  if (patch.port !== undefined) remote.port = patch.port;
  saveCliSettings(settings);
  return settings;
}

export function removeRemote(remoteIndex: number): CliSettings {
  const settings = loadCliSettings();
  settings.remotes.splice(remoteIndex, 1);
  saveCliSettings(settings);
  return settings;
}

export function addWorkPath(remoteIndex: number, path: string, alias: string): CliSettings {
  const settings = loadCliSettings();
  const remote = settings.remotes[remoteIndex];
  if (!remote) throw new Error(`Remote index ${remoteIndex} out of bounds`);
  remote.workPaths.push({ path, alias });
  saveCliSettings(settings);
  return settings;
}

export function updateWorkPath(remoteIndex: number, wpIndex: number, patch: Partial<WorkPathEntry>): CliSettings {
  const settings = loadCliSettings();
  const wp = settings.remotes[remoteIndex]?.workPaths[wpIndex];
  if (!wp) throw new Error(`WorkPath index out of bounds`);
  if (patch.path !== undefined) wp.path = patch.path;
  if (patch.alias !== undefined) wp.alias = patch.alias;
  saveCliSettings(settings);
  return settings;
}

export function removeWorkPath(remoteIndex: number, wpIndex: number): CliSettings {
  const settings = loadCliSettings();
  const remote = settings.remotes[remoteIndex];
  if (!remote) throw new Error(`Remote index ${remoteIndex} out of bounds`);
  remote.workPaths.splice(wpIndex, 1);
  saveCliSettings(settings);
  return settings;
}
