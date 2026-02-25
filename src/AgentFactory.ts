import {
    AgentService,
    IAgentCallback, IModelService, ModelServiceFactory,
    IAgentToolService, AgentToolService,
    ISkillService, SkillService,
    ServiceContainer, T_ThreadId, T_SystemPrompts, T_SkillsDirs,
} from "scorpio.ai";
import { ReActService } from "./Plan/index.js";
import { config, AgentEntry, AgentMode, SingleAgentEntry, ReactAgentEntry } from "./Config";
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
     * @param agentEntry Agent 配置条目
     * @param userId 用户 ID
     * @param agentName Agent 名称（用于加载 Agent 专属 skill/mcp，子 Agent 调用时可不传）
     * @param userInfo 用户信息（可选，用于追加到 systemPrompt）
     */
    static async create(
        container: ServiceContainer,
        agentEntry: AgentEntry,
        userId: string,
        agentName?: string,
        userInfo?: any,
    ): Promise<StreamableAgent> {
        if (agentName && !container.isRegistered(ISkillService)) {
            const skillsDirs = [
                config.getSkillsPath(),
                config.getAgentSkillsPath(agentName),
                ...(agentEntry.skills ?? []),
            ];
            container.registerWithArgs(ISkillService, SkillService, {
                [T_SkillsDirs]: skillsDirs,
            });
        }

        if (!container.isRegistered(IAgentToolService)) {
            container.registerSingleton(IAgentToolService, AgentToolService);
            const toolService = await container.resolve<AgentToolService>(IAgentToolService);
            const mcpServers = config.getMcpServers();
            if (Object.keys(mcpServers).length > 0) await toolService.addMcpServers(mcpServers);
            const builtinMcpServers = config.getBuiltinMcpServers();
            if (Object.keys(builtinMcpServers).length > 0) await toolService.addMcpServers(builtinMcpServers);
            if (agentName) {
                const entryMcp = Object.fromEntries(
                    (agentEntry.mcp ?? []).map(name => [name, mcpServers[name]]).filter(([, v]) => v)
                );
                if (Object.keys(entryMcp).length > 0) await toolService.addMcpServers(entryMcp);
                const agentMcpServers = config.getAgentMcpServers(agentName);
                if (Object.keys(agentMcpServers).length > 0) await toolService.addMcpServers(agentMcpServers);
            }
        }

        const agentType = agentEntry.type || AgentMode.Single;

        switch (agentType) {
            case AgentMode.ReAct:
                return this.createReAct(container, agentEntry as ReactAgentEntry, userId);

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
        let prompt = systemPrompt ?? "你是一个有用的AI助手";
        if (userInfo) {
            prompt += `\n用户user_id:${userInfo.user_id}\n用户open_id:${userInfo.open_id}\n用户union_id:${userInfo.union_id}\n用户姓名:${userInfo.name}\n用户邮箱:${userInfo.email}`;
        }
        return [prompt];
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

        const systemPrompt = this.buildSystemPrompt(entry.systemPrompt, userInfo);

        container.registerWithArgs(AgentService, {
            [T_ThreadId]: userId,
            [T_SystemPrompts]: systemPrompt,
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
    ): Promise<StreamableAgent> {
        const agentRefs = entry.agents || [];
        if (agentRefs.length === 0) {
            throw new Error("ReAct 模式未配置子 Agent");
        }

        const maxIterations = entry.maxIterations || 5;

        logger.info(`${userId} 创建 ReAct 模式，包含 ${agentRefs.length} 个 Agent，最大迭代 ${maxIterations} 次`);

        container.registerWithArgs(ReActService, {
            userId,
            agentRefs,
            maxIterations,
            thinkConfig: entry.think,
            reflectConfig: entry.reflect,
            container,
        });
        return container.resolve(ReActService);
    }
}
