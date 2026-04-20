import type { AgentPackage } from 'sbot.commons';

/** Response shape from a remote JSON source URL */
export interface RemoteAgentStoreJson {
  name?: string;
  agents: AgentPackage[];
}
