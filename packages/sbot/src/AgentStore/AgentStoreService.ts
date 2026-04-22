import { config, type AgentSourceEntry } from '../Core/Config';
import type {
  AgentPackage,
  AgentStoreSource,
} from 'sbot.commons';

/**
 * AgentStoreService -- source management and agent installation.
 */
export class AgentStoreService {

  // ── Source management ───────────────────────────────────────

  getSources(): AgentSourceEntry[] {
    return config.settings.agentSources ?? [];
  }

  addSource(entry: AgentSourceEntry): void {
    const s = config.settings;
    if (!s.agentSources) {
      s.agentSources = [];
    }
    s.agentSources.push(entry);
    config.saveSettings();
  }

  removeSource(index: number): void {
    const s = config.settings;
    if (!s.agentSources || index < 0 || index >= s.agentSources.length) return;
    s.agentSources.splice(index, 1);
    config.saveSettings();
  }

  // ── Install ─────────────────────────────────────────────────

  async install(
    pkg: AgentPackage,
    version: string,
    overwrite = false,
  ): Promise<{ agentId: string; conflict: boolean }> {
    const agentId = pkg.id;

    if (config.agentExists(agentId) && !overwrite) {
      return { agentId, conflict: true };
    }

    const ver = pkg.versions.find(v => v.version === version);
    if (!ver) throw new Error(`Version "${version}" not found for "${agentId}"`);

    config.saveAgent(agentId, {
      ...ver.agent,
      name: pkg.name,
      storeSource: {
        url: '',
        version: ver.version,
        installedAt: new Date().toISOString(),
      } as AgentStoreSource,
    });

    return { agentId, conflict: false };
  }
}
