import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { config } from '../Core/Config';
import { httpGetJson } from '../SkillHub/types';
import { globalSkillService } from '../Agent/GlobalSkillService';
import type {
  AgentPackage,
  AgentPackageVersion,
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
          const latestVersion = pkg.versions?.[0]?.version;
          const hasUpdate = installed
            ? latestVersion !== local!.storeSource?.version
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
   * Sub-agent dependencies (from `pkg.agent.agents`) are resolved from
   * `options.localAgents` first, then from `options.sourceUrl` (remote store).
   *
   * Skill dependencies (from `pkg.agent.skills`) are searched and installed
   * via `options.skillHub` (best-effort).
   */
  async install(
    pkg: AgentPackage,
    overwrite = false,
    options?: {
      /** Which version to install (index into pkg.versions, default 0 = latest) */
      versionIndex?: number;
      sourceUrl?: string;
      /** Sibling packages from the same source (flat array) for resolving sub-agent deps locally */
      localAgents?: AgentPackage[];
      skillHub?: SkillHubService;
      _installingIds?: Set<string>;
    },
  ): Promise<{ agentId: string; conflict: boolean; installed?: string[]; skippedDeps?: string[] }> {
    const agentId = pkg.id;
    const exists = config.agentExists(agentId);

    if (exists && !overwrite) {
      return { agentId, conflict: true };
    }

    const ver = pkg.versions[options?.versionIndex ?? 0];
    if (!ver) throw new Error(`Version index out of range for "${agentId}"`);

    // ── Restore MCP from package ──
    const agentConfig: Record<string, unknown> = { ...ver.agent };
    if (ver.mcp?.builtin?.length) {
      agentConfig.mcp = ver.mcp.builtin;
    }

    config.saveAgent(agentId, {
      ...agentConfig,
      name: pkg.name,
      storeSource: {
        url: '',
        version: ver.version,
        installedAt: new Date().toISOString(),
      } as AgentStoreSource,
    });

    // Write MCP servers to agent-specific mcp.json
    if (ver.mcp?.servers && Object.keys(ver.mcp.servers).length > 0) {
      config.saveAgentMcpServers(agentId, ver.mcp.servers as any);
    }

    const installed: string[] = [agentId];
    const skippedDeps: string[] = [];

    // ── Cascading: sub-agent dependencies (read from ver.agent.agents) ──
    const subAgentIds = Array.isArray(ver.agent.agents)
      ? (ver.agent.agents as { id: string }[]).map(a => a.id)
      : [];
    if (subAgentIds.length) {
      const installingIds = options?._installingIds ?? new Set<string>();
      installingIds.add(agentId);

      // Build lookup from localAgents (sibling packages in the same source)
      const localMap = new Map<string, AgentPackage>();
      if (options?.localAgents?.length) {
        for (const a of options.localAgents) localMap.set(a.id, a);
      }

      // Fetch remote only for sub-agents not in localAgents
      let remoteAgents: AgentPackage[] = [];
      const needRemote = subAgentIds.some(id => !localMap.has(id));
      if (needRemote && options?.sourceUrl) {
        try {
          const remote = await httpGetJson<RemoteAgentStoreJson>(options.sourceUrl);
          remoteAgents = remote?.agents ?? [];
        } catch {
          // Remote unreachable — will skip missing deps below
        }
      }

      for (const subId of subAgentIds) {
        if (installingIds.has(subId)) {
          skippedDeps.push(subId);
          continue;
        }
        if (config.agentExists(subId)) {
          continue;
        }

        const subPkg = localMap.get(subId) ?? remoteAgents.find(a => a.id === subId);
        if (!subPkg) {
          skippedDeps.push(subId);
          continue;
        }

        try {
          const subResult = await this.install(subPkg, false, {
            sourceUrl: options?.sourceUrl,
            localAgents: options?.localAgents,
            skillHub: options?.skillHub,
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
    if (ver.skillsBundle) {
      const buf = Buffer.from(ver.skillsBundle, 'base64');
      const zip = new AdmZip(buf);
      const targetDir = config.getAgentSkillsPath(agentId);
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
      zip.extractAllTo(targetDir, true);
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
        remoteVersion: browsed.pkg.versions[0].version,
        changes: this.diffChanges(local as AgentConfig, browsed.pkg.versions[0].agent as AgentConfig),
        pkg: browsed.pkg,
      });
    }

    return diffs;
  }

  /** Apply an update for a given agent id with the provided package. */
  applyUpdate(agentId: string, pkg: AgentPackage): boolean {
    const local = this.findLocal(agentId);
    if (!local) return false;

    const ver = pkg.versions[0];
    if (!ver) return false;

    config.saveAgent(agentId, {
      ...ver.agent,
      name: pkg.name,
      storeSource: {
        url: local.storeSource?.url ?? '',
        version: ver.version,
        installedAt: local.storeSource?.installedAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as AgentStoreSource,
    });

    return true;
  }

  // ── Export ───────────────────────────────────────────────────

  /**
   * Export a locally configured agent as a source-format JSON.
   * Returns `{ name, agents: AgentPackage[] }` with the main agent
   * and all sub-agents flattened into the array.
   */
  exportAgent(agentId: string): RemoteAgentStoreJson {
    const collected = new Map<string, AgentPackage>();
    this._collectAgentPackage(agentId, collected, new Set());

    const main = collected.get(agentId)!;
    // Put the main agent first, then the rest
    const agents: AgentPackage[] = [main];
    for (const [id, pkg] of collected) {
      if (id !== agentId) agents.push(pkg);
    }

    return { name: main.name, agents };
  }

  /** Recursively collect an agent and its sub-agents into a flat map. */
  private _collectAgentPackage(agentId: string, out: Map<string, AgentPackage>, visited: Set<string>): void {
    if (visited.has(agentId)) return; // cycle guard
    visited.add(agentId);

    let agent: any;
    try { agent = config.getAgent(agentId); } catch { /* not found */ }
    if (!agent) return;

    const { storeSource: _drop, id: _id, mcp: _mcp, skills: _skills, autoApproveTools: _aat, autoApproveAllTools: _aaat, ...agentFields } = agent;

    // Build a single version snapshot
    const ver: AgentPackageVersion = {
      version: agent.storeSource?.version ?? '0.0.0',
      agent: agentFields,
    };

    const subAgentIds = Array.isArray(agentFields.agents)
      ? (agentFields.agents as { id: string }[]).map(a => a.id)
      : [];

    // ── MCP: collect builtin refs + all server configs ──
    const mcpRefs = Array.isArray(agent.mcp) ? agent.mcp as string[] : [];
    const builtin = mcpRefs.filter((id: string) => id.startsWith('builtin_'));
    const nonBuiltinIds = mcpRefs.filter((id: string) => !id.startsWith('builtin_'));

    const servers: Record<string, unknown> = {};
    if (nonBuiltinIds.length) {
      const allGlobal = config.getGlobalMcpServers();
      for (const id of nonBuiltinIds) {
        if (allGlobal[id]) servers[id] = allGlobal[id];
      }
    }
    const agentMcpServers = config.getAgentMcpServers(agentId);
    Object.assign(servers, agentMcpServers);

    if (builtin.length || Object.keys(servers).length) {
      ver.mcp = { builtin, servers };
    }

    // ── Skills: bundle agent-specific + referenced global skills ──
    const skillsBundle = this._bundleSkills(agentId, agent.skills as string[] | '*' | undefined);
    if (skillsBundle) {
      ver.skillsBundle = skillsBundle;
    }

    out.set(agentId, {
      id: agentId,
      name: agent.name ?? agentId,
      versions: [ver],
    });

    // ── Recurse into sub-agents ──
    for (const subId of subAgentIds) {
      this._collectAgentPackage(subId, out, visited);
    }
  }

  // ── Skills bundling ─────────────────────────────────────────

  private _bundleSkills(agentId: string, agentSkills: string[] | '*' | undefined): string | undefined {
    const zip = new AdmZip();
    const added = new Set<string>();

    const agentSkillsDir = config.getAgentSkillsPath(agentId);
    if (fs.existsSync(agentSkillsDir)) {
      for (const entry of fs.readdirSync(agentSkillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const skillDir = path.join(agentSkillsDir, entry.name);
        if (!fs.existsSync(path.join(skillDir, 'SKILL.md'))) continue;
        this._addDirToZip(zip, skillDir, entry.name);
        added.add(entry.name);
      }
    }

    if (Array.isArray(agentSkills)) {
      const allGlobal = globalSkillService.getAllSkills();
      for (const skillName of agentSkills) {
        if (added.has(skillName)) continue;
        const skill = allGlobal.find(s => s.name === skillName);
        if (skill?.path && fs.existsSync(skill.path)) {
          this._addDirToZip(zip, skill.path, skillName);
          added.add(skillName);
        }
      }
    }

    if (added.size === 0) return undefined;
    return zip.toBuffer().toString('base64');
  }

  private _addDirToZip(zip: AdmZip, dirPath: string, zipPrefix: string): void {
    const walk = (dir: string, rel: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        const zipPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walk(fullPath, zipPath);
        } else {
          zip.addFile(`${zipPrefix}/${zipPath}`, fs.readFileSync(fullPath));
        }
      }
    };
    walk(dirPath, '');
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
