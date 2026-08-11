import type { AgentPackage } from '@sbot/shared';

/** Response shape from a remote JSON source URL */
export interface RemoteAgentStoreJson {
  name?: string;
  agents: AgentPackage[];
}
