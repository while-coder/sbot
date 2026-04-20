import fs from 'fs';
import AdmZip from 'adm-zip';
import { config, type AgentSourceEntry } from '../Core/Config';
import { httpGetJson } from '../SkillHub/types';
import type {
  AgentPackage,
  AgentStoreSource,
} from 'sbot.commons';
import type { RemoteAgentStoreJson } from './types';
import type { SkillHubService } from '../SkillHub';

/**
 * AgentStoreService -- source management, remote proxy, and agent installation.
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

  // ── Proxy ──────────────────────────────────────────────────

  /** Fetch remote agent store JSON on behalf of the frontend (avoids CORS). */
  async fetchRemoteJson(url: string): Promise<RemoteAgentStoreJson> {
    return httpGetJson<RemoteAgentStoreJson>(url);
  }

  // ── Install ─────────────────────────────────────────────────

  /**
   * Install an agent package into the agent directory.
   * If a conflict exists and `overwrite` is false, `conflict: true` is returned.
   *
   * Sub-agent dependencies are resolved from `options.localAgents` first,
   * then from `options.sourceUrl` (remote store).
   */
  async install(
    pkg: AgentPackage,
    overwrite = false,
    options?: {
      versionIndex?: number;
      sourceUrl?: string;
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

    if (ver.mcp?.servers && Object.keys(ver.mcp.servers).length > 0) {
      config.saveAgentMcpServers(agentId, ver.mcp.servers as any);
    }

    const installed: string[] = [agentId];
    const skippedDeps: string[] = [];

    // ── Cascading: sub-agent dependencies ──
    const subAgentIds = Array.isArray(ver.agent.agents)
      ? (ver.agent.agents as { id: string }[]).map(a => a.id)
      : [];
    if (subAgentIds.length) {
      const installingIds = options?._installingIds ?? new Set<string>();
      installingIds.add(agentId);

      const localMap = new Map<string, AgentPackage>();
      if (options?.localAgents?.length) {
        for (const a of options.localAgents) localMap.set(a.id, a);
      }

      let remoteAgents: AgentPackage[] = [];
      const needRemote = subAgentIds.some(id => !localMap.has(id));
      if (needRemote && options?.sourceUrl) {
        try {
          const remote = await httpGetJson<RemoteAgentStoreJson>(options.sourceUrl);
          remoteAgents = remote?.agents ?? [];
        } catch { /* skip */ }
      }

      for (const subId of subAgentIds) {
        if (installingIds.has(subId)) {
          skippedDeps.push(subId);
          continue;
        }
        if (config.agentExists(subId)) continue;

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
}
