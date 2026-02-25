import {
    AgentService,
    IAgentCallback, IModelService, ModelServiceFactory,
    ServiceContainer, T_ThreadId, T_SystemPrompts,
} from "scorpio.ai";
import { SupervisorService, ReActService } from "./Plan/index.js";
import { config, AgentEntry, AgentMode, AgentConfig, SingleAgentEntry, SupervisorAgentEntry, ReactAgentEntry } from "./Config";
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
     * @param container 已注册公共服务（saver、tool、skill、memory）的 DI 容器
     * @param agentEntry Agent 配置条目
     * @param userId 用户 ID
     * @param userInfo 用户信息（可选，用于追加到 systemPrompt）
     */
    static async create(
        container: ServiceContainer,
        agentEntry: AgentEntry,
        userId: string,
        userInfo?: any,
    ): Promise<StreamableAgent> {
        const agentType = agentEntry.type || AgentMode.Single;

        switch (agentType) {
            case AgentMode.Supervisor:
                return this.createSupervisor(container, agentEntry as SupervisorAgentEntry, userId);

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
     * 创建 Supervisor Agent
     */
    private static async createSupervisor(
        container: ServiceContainer,
        entry: SupervisorAgentEntry,
        userId: string,
    ): Promise<StreamableAgent> {
        const agentConfigs: AgentConfig[] = entry.agents || [];
        if (agentConfigs.length === 0) {
            throw new Error("Supervisor 模式未配置子 Agent");
        }

        logger.info(`${userId} 创建 Supervisor 模式，包含 ${agentConfigs.length} 个 Agent，model=${entry.model || '(default)'}`);

        await this.registerModel(container, entry.model);

        container.registerWithArgs(SupervisorService, {
            userId,
            threadId: userId,
            agentConfigs,
        });
        return container.resolve(SupervisorService);
    }

    /**
     * 创建 ReAct Agent
     */
    private static async createReAct(
        container: ServiceContainer,
        entry: ReactAgentEntry,
        userId: string,
    ): Promise<StreamableAgent> {
        const agentConfigs: AgentConfig[] = entry.agents || [];
        if (agentConfigs.length === 0) {
            throw new Error("ReAct 模式未配置子 Agent");
        }

        const maxIterations = entry.maxIterations || 5;
        const thinkModel = entry.think?.model;
        const reflectModel = entry.reflect?.model;

        logger.info(`${userId} 创建 ReAct 模式，包含 ${agentConfigs.length} 个 Agent，最大迭代 ${maxIterations} 次，think=${thinkModel || '(default)'}，reflect=${reflectModel || thinkModel || '(default)'}`);

        // think 节点主模型
        await this.registerModel(container, thinkModel);

        // reflect 节点独立模型（仅当与 think 不同时创建）
        let reflectModelService: IModelService | undefined;
        if (reflectModel && reflectModel !== thinkModel) {
            const reflectModelConfig = config.getModel(reflectModel);
            if (reflectModelConfig) {
                reflectModelService = await ModelServiceFactory.getModelService(reflectModelConfig);
            }
        }

        // 为有独立模型配置的子 Agent 预创建 ModelService
        const agentModelServices = new Map<string, IModelService>();
        for (const agentConfig of agentConfigs) {
            if (agentConfig.model && agentConfig.model !== thinkModel) {
                const subModelConfig = config.getModel(agentConfig.model);
                if (subModelConfig) {
                    agentModelServices.set(agentConfig.id, await ModelServiceFactory.getModelService(subModelConfig));
                }
            }
        }

        container.registerWithArgs(ReActService, {
            userId,
            threadId: userId,
            agentConfigs,
            maxIterations,
            thinkConfig: entry.think,
            reflectConfig: entry.reflect,
            reflectModelService,
            agentModelServices: agentModelServices.size > 0 ? agentModelServices : undefined,
        });
        return container.resolve(ReActService);
    }
}
