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
    T_ReactSystemPromptTemplate, T_ReactSubNodePrompt, T_ReactTaskToolDesc,
    T_SkillSystemPromptTemplate, T_SkillToolReadDesc, T_SkillToolListDesc, T_SkillToolExecDesc,
    type CreateAgentFn,
} from "scorpio.ai";
import { type AgentTool } from "./AgentRunner";
import { config, AgentMode, SingleAgentEntry, ReactAgentEntry } from "../Core/Config";
import { loadPrompt } from "../Core/PromptLoader";
import { globalAgentToolService } from "./GlobalAgentToolService";
import { globalSkillService } from "./GlobalSkillService";
import { getLogger } from "log4js";


export interface AgentCreateOptions {
    /** 要创建的 Agent 配置 ID */
    agentId: string;
    /** 当前请求的 DI 容器 */
    container: ServiceContainer;
    /** 注入到 system prompt 的额外上下文片段 */
    extraPrompts: string[];
    /** 动态注册到 Agent 的工具列表 */
    agentTools?: AgentTool[];
}

/**
 * Agent 工厂
 * 根据 AgentEntry 配置创建对应的 Agent 服务
 */
export class AgentFactory {

    static async create(options: AgentCreateOptions): Promise<AgentServiceBase> {
        const { agentId, container, extraPrompts, agentTools } = options;
        const agentEntry = config.getAgent(agentId);

        if (!container.isRegistered(IAgentSaverService)) container.registerSingleton(IAgentSaverService, AgentMemorySaver);
        const { mcp, skills } = agentEntry;
        await this.registerSkillService(container, agentId, skills);
        await this.registerToolService(container, agentId, mcp, agentTools);

        const systemPrompts = [loadPrompt('system/init.txt'), ...extraPrompts];
        if (agentEntry.systemPrompt)
            systemPrompts.push(agentEntry.systemPrompt);

        const createAgentFn: CreateAgentFn = (name, subContainer) =>
            AgentFactory.create({ agentId: name, container: subContainer, extraPrompts, agentTools });
        const agentType = agentEntry.type || AgentMode.Single;

        switch (agentType) {
            case AgentMode.ReAct:
                return this.createReAct(container, agentEntry as ReactAgentEntry, systemPrompts, createAgentFn);

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
        container.registerWithArgs(ISkillService, SkillService, {
            [T_SkillSystemPromptTemplate]: loadPrompt('skills/system.txt'),
            [T_SkillToolReadDesc]: loadPrompt('skills/tool_read_skill_file.txt'),
            [T_SkillToolListDesc]: loadPrompt('skills/tool_list_skill_files.txt'),
            [T_SkillToolExecDesc]: loadPrompt('skills/tool_execute_skill_script.txt'),
        });
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
        agentTools?: AgentTool[],
    ): Promise<void> {
        container.registerSingleton(IAgentToolService, AgentToolService);
        const toolService = await container.resolve<AgentToolService>(IAgentToolService);
        if (mcp && mcp.length > 0) {
            const mcpNames = [...mcp];
            toolService.registerToolFactory('__global_mcp__', () => globalAgentToolService.getToolsFrom(mcpNames));
        }
        if (agentTools) {
            for (const tool of agentTools) {
                toolService.registerToolFactory(tool.name, () => Promise.resolve(tool.factory()));
            }
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
        systemPrompts: string[],
        createAgentFn: CreateAgentFn,
    ): Promise<AgentServiceBase> {
        const agentSubNodes = entry.agents || [];
        if (agentSubNodes.length === 0) {
            throw new Error("ReAct mode: no sub-agents configured");
        }
        if (!entry.think) {
            throw new Error("ReAct mode: think modelName not configured");
        }
        const thinkModelService = await config.getModelService(entry.think, true);
        container.registerWithArgs(ReActAgentService, {
            [T_AgentSubNodes]: agentSubNodes,
            [T_CreateAgent]: createAgentFn,
            [T_ThinkModelService]: thinkModelService,
            [T_SystemPrompts]: systemPrompts,
            [T_ReactSystemPromptTemplate]: loadPrompt('agent/react_system.txt'),
            [T_ReactSubNodePrompt]: loadPrompt('agent/react_subnode.txt'),
            [T_ReactTaskToolDesc]: loadPrompt('agent/react_task.txt'),
        });
        return container.resolve(ReActAgentService);
    }
}
