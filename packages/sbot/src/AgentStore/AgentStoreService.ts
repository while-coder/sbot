import { config } from '../Core/Config';
import { httpGetJson } from '../SkillHub/types';
import type {
  AgentPackage,
  AgentSourceEntry,
  AgentUpdateDiff,
  AgentConfig,
  AgentStoreSource,
  Settings as CommonsSettings,
} from 'sbot.commons';
import type { RemoteAgentStoreJson, BrowsedAgent } from './types';
import type { SkillHubService } from '../SkillHub';

/**
 * Cast config.settings to the sbot.commons Settings shape so we can
 * access `agentSources`.
 */
function getSettings(): CommonsSettings {
  return config.settings as unknown as CommonsSettings;
}

/**
 * AgentStoreService -- browse, install, update, and export agent packages
 * from remote agent sources.
 */
export class AgentStoreService {
  private updateTimer: ReturnType<typeof setInterval> | null = null;
  private _pendingUpdates: AgentUpdateDiff[] = [];

  get pendingUpdates(): AgentUpdateDiff[] {
    return this._pendingUpdates;
  }

  // ── Source management ───────────────────────────────────────

  /** Return all configured agent sources. */
  getSources(): AgentSourceEntry[] {
    return getSettings().agentSources ?? [];
  }

  /** Append a new source entry and persist. */
  addSource(entry: AgentSourceEntry): void {
    const s = getSettings();
    if (!s.agentSources) {
      s.agentSources = [];
    }
    s.agentSources.push(entry);
    config.saveSettings();
  }

  /** Remove the source at `index` and persist. */
  removeSource(index: number): void {
    const s = getSettings();
    if (!s.agentSources || index < 0 || index >= s.agentSources.length) return;
    s.agentSources.splice(index, 1);
    config.saveSettings();
  }

  // ── Browse ──────────────────────────────────────────────────

  /**
   * Fetch available agent packages from remote sources.
   * If `sourceUrl` is given, only that source is fetched.
   * Otherwise all enabled sources are fetched.
   */
  async fetchRemoteAgents(sourceUrl?: string): Promise<BrowsedAgent[]> {
    const sources = this.getSources();
    const targets = sourceUrl
      ? [{ url: sourceUrl, name: undefined as string | undefined, enabled: true }]
      : sources.filter(s => s.enabled !== false);

    const results: BrowsedAgent[] = [];

    for (const src of targets) {
      try {
        const remote = await httpGetJson<RemoteAgentStoreJson>(src.url);
        const agents = remote?.agents;
        if (!Array.isArray(agents)) continue;

        for (const pkg of agents) {
          if (!pkg.id) continue;
          const local = this.findLocal(pkg.id);
          const installed = local !== null;
          const hasUpdate = installed
            ? pkg.version !== local!.storeSource?.version
            : false;

          results.push({
            sourceUrl: src.url,
            sourceName: src.name ?? remote.name,
            installed,
            installedId: installed ? pkg.id : undefined,
            hasUpdate,
            pkg,
          });
        }
      } catch {
        // skip unreachable sources
      }
    }

    return results;
  }

  // ── Install ─────────────────────────────────────────────────

  /**
   * Install an agent package into the agent directory.
   * Returns the agentId and whether a conflict was detected.
   * If a conflict exists and `overwrite` is false, the agent is NOT written
   * and `conflict: true` is returned.
   *
   * When `options.sourceUrl` is provided, sub-agent dependencies declared in
   * `pkg.requires.subAgents` are fetched from the same remote store and
   * installed recursively (with cycle detection).
   *
   * When `options.skillHub` is provided, skill dependencies declared in
   * `pkg.requires.skills` are searched and installed into the agent's skills
   * directory (best-effort).
   */
  async install(
    pkg: AgentPackage,
    overwrite = false,
    options?: { sourceUrl?: string; skillHub?: SkillHubService; _installingIds?: Set<string> },
  ): Promise<{ agentId: string; conflict: boolean; installed?: string[]; skippedDeps?: string[] }> {
    const agentId = pkg.id;
    const exists = config.agentExists(agentId);

    if (exists && !overwrite) {
      return { agentId, conflict: true };
    }

    config.saveAgent(agentId, {
      ...pkg.agent,
      name: pkg.name,
      storeSource: {
        url: '',
        version: pkg.version,
        installedAt: new Date().toISOString(),
      } as AgentStoreSource,
    });

    const installed: string[] = [agentId];
    const skippedDeps: string[] = [];

    // ── Cascading: sub-agent dependencies ──
    if (pkg.requires?.subAgents?.length && options?.sourceUrl) {
      const installingIds = options._installingIds ?? new Set<string>();
      installingIds.add(agentId);

      let remoteAgents: AgentPackage[] = [];
      try {
        const remote = await httpGetJson<RemoteAgentStoreJson>(options.sourceUrl);
        remoteAgents = remote?.agents ?? [];
      } catch {
        // If the remote store is unreachable, skip all sub-agent deps
        skippedDeps.push(...pkg.requires.subAgents);
      }

      for (const subId of pkg.requires.subAgents) {
        if (installingIds.has(subId)) {
          // Cycle detected — skip
          skippedDeps.push(subId);
          continue;
        }
        if (config.agentExists(subId)) {
          // Already installed locally — skip
          continue;
        }

        const subPkg = remoteAgents.find(a => a.id === subId);
        if (!subPkg) {
          skippedDeps.push(subId);
          continue;
        }

        try {
          const subResult = await this.install(subPkg, false, {
            sourceUrl: options.sourceUrl,
            skillHub: options.skillHub,
            _installingIds: installingIds,
          });
          if (subResult.installed) installed.push(...subResult.installed);
          if (subResult.skippedDeps) skippedDeps.push(...subResult.skippedDeps);
        } catch {
          skippedDeps.push(subId);
        }
      }
    }

    // ── Cascading: skill dependencies ──
    if (pkg.requires?.skills?.length && options?.skillHub) {
      for (const skillName of pkg.requires.skills) {
        try {
          const results = await options.skillHub.searchSkills(skillName, 1);
          if (results.length > 0) {
            await options.skillHub.installSkill(results[0], config.getAgentSkillsPath(agentId));
          } else {
            skippedDeps.push(`skill:${skillName}`);
          }
        } catch {
          skippedDeps.push(`skill:${skillName}`);
        }
      }
    }

    return { agentId, conflict: false, installed, skippedDeps };
  }

  // ── Update ──────────────────────────────────────────────────

  /** Check all installed store-sourced agents for available updates. */
  async checkUpdates(): Promise<AgentUpdateDiff[]> {
    const remoteAgents = await this.fetchRemoteAgents();
    const diffs: AgentUpdateDiff[] = [];

    for (const browsed of remoteAgents) {
      if (!browsed.installed || !browsed.hasUpdate) continue;

      const local = this.findLocal(browsed.pkg.id);
      if (!local) continue;

      diffs.push({
        id: browsed.pkg.id,
        localVersion: local.storeSource?.version,
        remoteVersion: browsed.pkg.version,
        changes: this.diffChanges(local as AgentConfig, browsed.pkg.agent),
        pkg: browsed.pkg,
      });
    }

    return diffs;
  }

  /** Apply an update for a given agent id with the provided package. */
  applyUpdate(agentId: string, pkg: AgentPackage): boolean {
    const local = this.findLocal(agentId);
    if (!local) return false;

    config.saveAgent(agentId, {
      ...pkg.agent,
      name: pkg.name,
      storeSource: {
        url: local.storeSource?.url ?? '',
        version: pkg.version,
        installedAt: local.storeSource?.installedAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as AgentStoreSource,
    });

    return true;
  }

  // ── Export / Import ─────────────────────────────────────────

  /** Export a locally configured agent as a portable AgentPackage. */
  exportAgent(agentId: string): AgentPackage {
    let agent: any;
    try { agent = config.getAgent(agentId); } catch { /* not found */ }
    if (!agent) throw new Error(`Agent "${agentId}" not found`);

    const { storeSource: _drop, id: _id, ...agentFields } = agent;

    return {
      id: agentId,
      name: agent.name ?? agentId,
      version: agent.storeSource?.version ?? '0.0.0',
      agent: agentFields,
    };
  }

  /** Fetch an AgentPackage from a remote URL. */
  async importFromUrl(url: string): Promise<AgentPackage> {
    const data = await httpGetJson<AgentPackage>(url);
    return this.importFromJson(data);
  }

  /** Validate and return an AgentPackage from raw JSON. */
  importFromJson(raw: unknown): AgentPackage {
    if (!raw || typeof raw !== 'object') {
      throw new Error('Invalid agent package: expected an object');
    }
    const obj = raw as Record<string, unknown>;
    if (typeof obj.id !== 'string' || !obj.id) {
      throw new Error('Invalid agent package: missing "id"');
    }
    if (typeof obj.name !== 'string' || !obj.name) {
      throw new Error('Invalid agent package: missing "name"');
    }
    if (typeof obj.version !== 'string' || !obj.version) {
      throw new Error('Invalid agent package: missing "version"');
    }
    if (!obj.agent || typeof obj.agent !== 'object') {
      throw new Error('Invalid agent package: missing "agent" config');
    }
    return raw as AgentPackage;
  }

  // ── Private helpers ─────────────────────────────────────────

  /** Find a locally installed agent by its id (directory name). */
  private findLocal(agentId: string): (AgentConfig & { storeSource?: AgentStoreSource }) | null {
    try {
      const agent = config.getAgent(agentId);
      return agent as any;
    } catch {
      return null;
    }
  }

  /**
   * Compare key fields between a local config and a remote agent config,
   * returning a human-readable list of changes.
   */
  private diffChanges(
    local: AgentConfig,
    remote: Omit<AgentConfig, 'storeSource'>,
  ): string[] {
    const changes: string[] = [];

    if (local.type !== remote.type) {
      changes.push(`type: "${local.type}" -> "${remote.type}"`);
    }
    if (local.model !== remote.model) {
      changes.push(`model changed`);
    }
    if (local.systemPrompt !== remote.systemPrompt) {
      changes.push(`systemPrompt changed`);
    }

    const localMcp = JSON.stringify(local.mcp ?? null);
    const remoteMcp = JSON.stringify(remote.mcp ?? null);
    if (localMcp !== remoteMcp) {
      changes.push(`mcp servers changed`);
    }

    const localSkills = JSON.stringify(local.skills ?? null);
    const remoteSkills = JSON.stringify(remote.skills ?? null);
    if (localSkills !== remoteSkills) {
      changes.push(`skills changed`);
    }

    const localAgents = JSON.stringify(local.agents ?? null);
    const remoteAgents = JSON.stringify(remote.agents ?? null);
    if (localAgents !== remoteAgents) {
      changes.push(`sub-agents changed`);
    }

    if (changes.length === 0) {
      changes.push('version bump (no config changes detected)');
    }

    return changes;
  }

  // ── Auto-update scheduler ──────────────────────────────────

  /** Start periodic update checks. `broadcastFn` sends WS notifications to clients. */
  startAutoUpdate(broadcastFn?: (data: string) => void): void {
    this.stopAutoUpdate();
    const interval = this.getMinUpdateInterval();
    if (interval <= 0) return;

    this.updateTimer = setInterval(async () => {
      try {
        this._pendingUpdates = await this.checkUpdates();
        if (this._pendingUpdates.length > 0 && broadcastFn) {
          broadcastFn(JSON.stringify({
            type: 'agent-store-updates',
            count: this._pendingUpdates.length,
          }));
        }
      } catch { /* ignore */ }
    }, interval * 60 * 1000);
  }

  /** Stop the periodic update timer. */
  stopAutoUpdate(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }

  /** Get the minimum update interval across all auto-update-enabled sources. */
  private getMinUpdateInterval(): number {
    const sources = getSettings().agentSources ?? [];
    const intervals = sources
      .filter(s => s.enabled !== false && s.autoUpdate !== false)
      .map(s => s.updateInterval ?? 60);
    return intervals.length > 0 ? Math.min(...intervals) : 0;
  }
}
