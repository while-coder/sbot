import {
    AgentService,
    IAgentCallback, IModelService, ModelServiceFactory,
    IAgentToolService, AgentToolService,
    ISkillService, SkillService,
    ServiceContainer, T_ThreadId, T_SystemPrompts, T_SkillsDirs, T_SkillDirs,
} from "scorpio.ai";
import path from "path";
import { ReActService } from "./Plan/index.js";
import { config, AgentMode, SingleAgentEntry, ReactAgentEntry } from "./Config";
import { LoggerService } from "./LoggerService";

const logger = LoggerService.getLogger("AgentFactory.ts");

export interface StreamableAgent {
    stream(query: string, callback: IAgentCallback): Promise<void>;
}

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
        userId: string,
        userInfo?: any,
    ): Promise<StreamableAgent> {
        const agentEntry = config.settings.agents?.[agentName];
        if (!agentEntry) throw new Error(`Agent 配置 "${agentName}" 不存在`);
        if (!container.isRegistered(ISkillService)) {
            const args: Record<symbol, any> = {
                [T_SkillsDirs]: [config.getAgentSkillsPath(agentName)],
            };
            if (agentEntry.skills && agentEntry.skills.length > 0) {
                args[T_SkillDirs] = agentEntry.skills.map(name => path.join(config.getSkillsPath(), name));
            }
            container.registerWithArgs(ISkillService, SkillService, args);
        }

        if (!container.isRegistered(IAgentToolService)) {
            container.registerSingleton(IAgentToolService, AgentToolService);
            const toolService = await container.resolve<AgentToolService>(IAgentToolService);
            const mcpServers = config.getMcpServers();
            if (agentEntry.mcp && agentEntry.mcp.length > 0) {
                const filteredMcp = Object.fromEntries(
                    agentEntry.mcp.map(name => [name, mcpServers[name]]).filter(([, v]) => v)
                );
                await toolService.addMcpServers(filteredMcp);
            }
            const agentMcpServers = config.getAgentMcpServers(agentName);
            await toolService.addMcpServers(agentMcpServers);
        }

        const agentType = agentEntry.type || AgentMode.Single;

        switch (agentType) {
            case AgentMode.ReAct:
                return this.createReAct(container, agentEntry as ReactAgentEntry, userId, userInfo);

            case AgentMode.Single:
            default:
                return this.createSingle(container, agentEntry as SingleAgentEntry, userId, userInfo);
        }
    }

    /**
     * 注册模型服务到容器
     */
    private static async registerModel(container: ServiceContainer, modelName?: string): Promise<void> {
        const modelConfig = config.getModel(modelName);
        if (!modelConfig) {
            throw new Error(`模型配置 "${modelName}" 不存在`);
        }
        const modelService = await ModelServiceFactory.getModelService(modelConfig);
        container.registerInstance(IModelService, modelService);
    }

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
        userId: string,
        userInfo?: any,
    ): Promise<StreamableAgent> {
        logger.info(`${userId} 创建单 Agent 模式，model=${entry.model || '(default)'}`);

        await this.registerModel(container, entry.model);

        const systemPrompts = this.buildSystemPrompt(entry.systemPrompt, userInfo);

        container.registerWithArgs(AgentService, {
            [T_ThreadId]: userId,
            [T_SystemPrompts]: systemPrompts,
        });
        return container.resolve(AgentService);
    }

    /**
     * 创建 ReAct Agent
     */
    private static async createReAct(
        container: ServiceContainer,
        entry: ReactAgentEntry,
        userId: string,
        userInfo?: any,
    ): Promise<StreamableAgent> {
        const agentRefs = entry.agents || [];
        if (agentRefs.length === 0) {
            throw new Error("ReAct 模式未配置子 Agent");
        }

        const maxIterations = entry.maxIterations || 5;

        logger.info(`${userId} 创建 ReAct 模式，包含 ${agentRefs.length} 个 Agent，最大迭代 ${maxIterations} 次`);

        const systemPrompts = this.buildSystemPrompt(entry.systemPrompt, userInfo);
        container.registerWithArgs(ReActService, {
            userId,
            agentRefs,
            maxIterations,
            thinkConfig: entry.think,
            reflectConfig: entry.reflect,
            container,
            userInfo,
            [T_SystemPrompts]: systemPrompts,
        });
        return container.resolve(ReActService);
    }
}
