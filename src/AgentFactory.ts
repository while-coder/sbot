import {
    AgentServiceBase, SingleAgentService,
    IModelService,
    IAgentToolService, AgentToolService,
    ISkillService, SkillService,
    ServiceContainer, T_SystemPrompts,
} from "scorpio.ai";
import { ReActAgentService, SupervisorAgentService } from "./Agents/index.js";
import { config, AgentMode, SingleAgentEntry, ReactAgentEntry, SupervisorAgentEntry } from "./Config";
import { globalAgentToolService } from "./GlobalAgentToolService";
import { globalSkillService } from "./GlobalSkillService";


/**
 * Agent 工厂
 * 根据 AgentEntry 配置创建对应的 Agent 服务
 */
export class AgentFactory {

    /**
     * 根据 AgentEntry 创建 Agent 服务
     * @param container DI 容器（已注册 memory 等公共服务）
     * @param userId 用户 ID
     * @param agentName Agent 名称（对应 config.settings.agents 中的 key）
     * @param userInfo 用户信息（可选，用于追加到 systemPrompt）
     */
    static async create(
        agentName: string,
        container: ServiceContainer,
        userInfo?: any,
    ): Promise<AgentServiceBase> {
        const agentEntry = config.settings.agents?.[agentName];
        if (!agentEntry) throw new Error(`Agent 配置 "${agentName}" 不存在`);
        if (!container.isRegistered(ISkillService)) {
            container.registerSingleton(ISkillService, SkillService);
            const skillService = await container.resolve<SkillService>(ISkillService);
            if (agentEntry.skills && agentEntry.skills.length > 0) {
                const allGlobalSkills = globalSkillService.getAllSkills();
                for (const name of agentEntry.skills) {
                    const skill = allGlobalSkills.find(s => s.name === name);
                    if (skill) skillService.registerSingleSkillDir(skill.path);
                }
            }
            skillService.registerSkillsDir(config.getAgentSkillsPath(agentName));
        }

        if (!container.isRegistered(IAgentToolService)) {
            container.registerSingleton(IAgentToolService, AgentToolService);
            const toolService = await container.resolve<AgentToolService>(IAgentToolService);
            if (agentEntry.mcp && agentEntry.mcp.length > 0) {
                const mcpNames = [...agentEntry.mcp];
                toolService.registerToolFactory('__global_mcp__', () => globalAgentToolService.getToolsFrom(mcpNames));
            }
            const agentMcpServers = config.getAgentMcpServers(agentName);
            toolService.registerMcpServers(agentMcpServers);
        }

        const agentType = agentEntry.type || AgentMode.Single;

        switch (agentType) {
            case AgentMode.ReAct:
                return this.createReAct(container, agentEntry as ReactAgentEntry, userInfo);

            case AgentMode.Supervisor:
                return this.createSupervisor(container, agentEntry as SupervisorAgentEntry, userInfo);

            case AgentMode.Single:
            default:
                return this.createSingle(container, agentEntry as SingleAgentEntry, userInfo);
        }
    }

    /**
     * 注册模型服务到容器
     */
    /**
     * 构建 systemPrompt，追加用户信息
     */
    private static buildSystemPrompt(systemPrompt: string | undefined, userInfo?: any): string[] {
        const prompts: string[] = [systemPrompt ?? "你是一个有用的AI助手"];
        if (userInfo) {
            prompts.push(`用户user_id:${userInfo.user_id}
用户open_id:${userInfo.open_id}
用户union_id:${userInfo.union_id}
用户姓名:${userInfo.name}
用户邮箱:${userInfo.email}`);
        }
        return prompts;
    }

    /**
     * 创建 Single Agent
     */
    private static async createSingle(
        container: ServiceContainer,
        entry: SingleAgentEntry,
        userInfo?: any,
    ): Promise<AgentServiceBase> {
        container.registerInstance(IModelService, await config.getModelService(entry.model, true));

        const systemPrompts = this.buildSystemPrompt(entry.systemPrompt, userInfo);

        container.registerWithArgs(SingleAgentService, {
            [T_SystemPrompts]: systemPrompts,
        });
        return container.resolve(SingleAgentService);
    }

    /**
     * 创建 Supervisor Agent
     */
    private static async createSupervisor(
        container: ServiceContainer,
        entry: SupervisorAgentEntry,
        userInfo?: any,
    ): Promise<AgentServiceBase> {
        const agentRefs = entry.agents || [];
        if (agentRefs.length === 0) {
            throw new Error("Supervisor 模式未配置 Worker Agent");
        }

        const maxRounds = entry.maxRounds || 10;
        const systemPrompts = this.buildSystemPrompt(entry.systemPrompt, userInfo);
        container.registerWithArgs(SupervisorAgentService, {
            agentRefs,
            maxRounds,
            supervisorConfig: entry.supervisor,
            userInfo,
            [T_SystemPrompts]: systemPrompts,
        });
        return container.resolve(SupervisorAgentService);
    }

    /**
     * 创建 ReAct Agent
     */
    private static async createReAct(
        container: ServiceContainer,
        entry: ReactAgentEntry,
        userInfo?: any,
    ): Promise<AgentServiceBase> {
        const agentRefs = entry.agents || [];
        if (agentRefs.length === 0) {
            throw new Error("ReAct 模式未配置子 Agent");
        }

        const maxIterations = entry.maxIterations || 5;

        const systemPrompts = this.buildSystemPrompt(entry.systemPrompt, userInfo);
        container.registerWithArgs(ReActAgentService, {
            agentRefs,
            maxIterations,
            thinkConfig: entry.think,
            reflectConfig: entry.reflect,
            userInfo,
            [T_SystemPrompts]: systemPrompts,
        });
        return container.resolve(ReActAgentService);
    }
}
