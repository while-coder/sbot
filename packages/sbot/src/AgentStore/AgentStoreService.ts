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

  // ── Export ──────────────────────────────────────────────────

  export(id: string): { name: string; agents: AgentPackage[] } {
    const agents: AgentPackage[] = [];
    const visited = new Set<string>();
    this._collectAgent(id, agents, visited);
    return { name: agents[0]?.name ?? id, agents };
  }

  private _exportOne(id: string): AgentPackage {
    const agent = config.getAgent(id);
    const { storeSource, mcp, skills, autoApproveTools, autoApproveAllTools, model, id: _id, ...agentFields } = agent as any;
    return {
      id,
      name: agent.name ?? id,
      versions: [{ version: '1.0.0', agent: agentFields }],
    };
  }

  private _collectAgent(id: string, result: AgentPackage[], visited: Set<string>): void {
    if (visited.has(id)) return;
    visited.add(id);
    if (!config.agentExists(id)) return;
    const pkg = this._exportOne(id);
    result.push(pkg);
    const subAgents = pkg.versions[0]?.agent.agents;
    if (Array.isArray(subAgents)) {
      for (const sub of subAgents) {
        this._collectAgent(sub.id, result, visited);
      }
    }
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
