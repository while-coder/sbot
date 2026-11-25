import type { AgentStoreService } from '../../AgentStore';

export interface RouteContext {
    agentStoreService: AgentStoreService;
    settingsWithAgents: () => any;
    shutdown: () => Promise<void>;
}
