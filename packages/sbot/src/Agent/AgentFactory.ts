import {
    AgentServiceBase, SingleAgentService,
    IModelService,
    IAgentSaverService, AgentMemorySaver,
} from "scorpio.ai";
import {
    IAgentToolService, AgentToolService,
    ISkillService, SkillService,
    ServiceContainer, T_SystemPrompts,
    ReActAgentService, T_AgentSubNodes, T_CreateAgent, T_ThinkModelService,
    type CreateAgentFn,
} from "scorpio.ai";
import { config, AgentMode, SingleAgentEntry, ReactAgentEntry } from "../Core/Config";
import { globalAgentToolService } from "./GlobalAgentToolService";
import { globalSkillService } from "./GlobalSkillService";


/**
 * Agent 工厂
 * 根据 AgentEntry 配置创建对应的 Agent 服务
 */
export class AgentFactory {

    static async create(
        agentId: string,
        container: ServiceContainer,
        first: boolean,
        extraPrompts?: string[],
    ): Promise<AgentServiceBase> {
        const agentEntry = config.getAgent(agentId);

        if (!container.isRegistered(IAgentSaverService)) container.registerSingleton(IAgentSaverService, AgentMemorySaver);
        const { mcp, skills } = agentEntry as SingleAgentEntry;
        await this.registerSkillService(container, agentId, skills);
        await this.registerToolService(container, agentId, mcp);

        const systemPrompts = [...(extraPrompts ?? [])];
        if (first && agentEntry.systemPrompt)
            systemPrompts.push(agentEntry.systemPrompt);
        const createAgentFn: CreateAgentFn = (name, subContainer) =>
            AgentFactory.create(name, subContainer, false, extraPrompts);
        const agentType = agentEntry.type || AgentMode.Single;

        switch (agentType) {
            case AgentMode.ReAct:
                return this.createReAct(container, agentEntry as ReactAgentEntry, createAgentFn);

            case AgentMode.Single:
            default:
                return this.createSingle(container, agentEntry as SingleAgentEntry, systemPrompts);
        }
    }

    private static async registerSkillService(
        container: ServiceContainer,
        agentName: string,
        skills?: string[],
    ): Promise<void> {
        if (container.isRegistered(ISkillService)) return;
        container.registerSingleton(ISkillService, SkillService);
        const skillService = await container.resolve<SkillService>(ISkillService);
        if (skills && skills.length > 0) {
            const allGlobalSkills = globalSkillService.getAllSkills();
            for (const name of skills) {
                const skill = allGlobalSkills.find(s => s.name === name);
                if (skill) skillService.registerSingleSkillDir(skill.path);
            }
        }
        skillService.registerSkillsDir(config.getAgentSkillsPath(agentName));
    }

    private static async registerToolService(
        container: ServiceContainer,
        agentName: string,
        mcp?: string[],
    ): Promise<void> {
        if (container.isRegistered(IAgentToolService)) return;
        container.registerSingleton(IAgentToolService, AgentToolService);
        const toolService = await container.resolve<AgentToolService>(IAgentToolService);
        if (mcp && mcp.length > 0) {
            const mcpNames = [...mcp];
            toolService.registerToolFactory('__global_mcp__', () => globalAgentToolService.getToolsFrom(mcpNames));
        }
        toolService.registerMcpServers(config.getAgentMcpServers(agentName));
    }

    /**
     * 创建 Single Agent
     */
    private static async createSingle(
        container: ServiceContainer,
        entry: SingleAgentEntry,
        systemPrompts: string[],
    ): Promise<AgentServiceBase> {
        container.registerInstance(IModelService, await config.getModelService(entry.model, true));

        container.registerWithArgs(SingleAgentService, {
            [T_SystemPrompts]: systemPrompts,
        });
        return container.resolve(SingleAgentService);
    }

    /**
     * 创建 ReAct Agent
     */
    private static async createReAct(
        container: ServiceContainer,
        entry: ReactAgentEntry,
        createAgentFn: CreateAgentFn,
    ): Promise<AgentServiceBase> {
        const agentSubNodes = entry.agents || [];
        if (agentSubNodes.length === 0) {
            throw new Error("ReAct 模式未配置子 Agent");
        }
        if (!entry.think) {
            throw new Error("ReAct 模式未配置 think modelName");
        }
        const thinkModelService = await config.getModelService(entry.think, true);

        container.registerWithArgs(ReActAgentService, {
            [T_AgentSubNodes]: agentSubNodes,
            [T_CreateAgent]: createAgentFn,
            [T_ThinkModelService]: thinkModelService,
        });
        return container.resolve(ReActAgentService);
    }
}
