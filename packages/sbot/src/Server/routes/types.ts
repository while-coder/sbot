import type { SkillHubService } from '../../SkillHub';
import type { AgentStoreService } from '../../AgentStore';

export interface RouteContext {
    skillHubService: SkillHubService;
    agentStoreService: AgentStoreService;
    settingsWithAgents: () => any;
    shutdown: () => Promise<void>;
}
