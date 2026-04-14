import type { AgentPackage } from 'sbot.commons';

/** Response shape from a remote JSON source URL */
export interface RemoteAgentStoreJson {
  name?: string;
  agents: AgentPackage[];
}

/** Browsed agent with source metadata attached */
export interface BrowsedAgent {
  sourceUrl: string;
  sourceName?: string;
  installed: boolean;
  installedId?: string;
  hasUpdate: boolean;
  pkg: AgentPackage;
}
