import {
    AgentServiceBase, SingleAgentService,
    IModelService,
    IMemoryService, IMemoryDatabase, MemorySqliteDatabase, MemoryEvaluator, MemoryCompressor, MemoryExtractor, MemoryService,
    IEmbeddingService,
    IMemoryExtractor, IMemoryEvaluator, IMemoryCompressor,
    IAgentSaverService, AgentSqliteSaver,
    T_MaxMemoryAgeDays, T_MemoryMode, T_DBPath,
    IAgentToolService, AgentToolService,
    ISkillService, SkillService,
    ServiceContainer, T_SystemPrompts,
    ReActAgentService, T_AgentSubNodes, T_MaxIterations, T_CreateAgent, T_ThinkModelService, T_ReflectModelService,
    SupervisorAgentService, T_SupervisorSubNodes, T_SupervisorMaxRounds, T_SupervisorModelService,
    type CreateAgentFn,
} from "scorpio.ai";
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

        await this.registerMemoryService(container, agentEntry.memory);
        await this.registerSaverService(container, agentEntry.saver);
        await this.registerSkillService(container, agentName, agentEntry.skills);
        await this.registerToolService(container, agentName, agentEntry.mcp);

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

    private static async registerMemoryService(
        container: ServiceContainer,
        memoryName?: string,
    ): Promise<void> {
        if (container.isRegistered(IMemoryService)) return;
        const memoryConfig = config.getMemory(memoryName);
        if (!memoryConfig?.embedding) return;

        const evaluatorModel = await config.getModelService(memoryConfig.evaluator);
        if (evaluatorModel) {
            container.registerWithArgs(IMemoryEvaluator, MemoryEvaluator, {
                [IModelService]: evaluatorModel,
            });
        }
        const extractorModel = await config.getModelService(memoryConfig.extractor);
        if (extractorModel) {
            container.registerWithArgs(IMemoryExtractor, MemoryExtractor, {
                [IModelService]: extractorModel,
            });
        }
        const compressorModel = await config.getModelService(memoryConfig.compressor);
        if (compressorModel) {
            container.registerWithArgs(IMemoryCompressor, MemoryCompressor, {
                [IModelService]: compressorModel,
            });
        }
        container.registerWithArgs(IMemoryDatabase, MemorySqliteDatabase, {
            [T_DBPath]: config.getMemoryPath(memoryName!),
        });
        container.registerWithArgs(IMemoryService, MemoryService, {
            [IEmbeddingService]: await config.getEmbeddingService(memoryConfig.embedding, true),
            [T_MaxMemoryAgeDays]: memoryConfig.maxAgeDays,
            [T_MemoryMode]: memoryConfig.mode,
        });
    }

    private static async registerSaverService(
        container: ServiceContainer,
        saverName?: string,
    ): Promise<void> {
        if (container.isRegistered(IAgentSaverService)) return;
        const saverConfig = config.getSaver(saverName);
        if (saverConfig === undefined) return;

        container.registerWithArgs(IAgentSaverService, AgentSqliteSaver, {
            [T_DBPath]: config.getSaverPath(saverName!),
        });
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
        if (!entry.supervisor?.model) {
            throw new Error("Supervisor 模式 supervisor 节点未配置 model");
        }

        const maxRounds = entry.maxRounds || 10;
        const systemPrompts = this.buildSystemPrompt(entry.systemPrompt, userInfo);

        const createAgentFn: CreateAgentFn = (name, subContainer) =>
            AgentFactory.create(name, subContainer, userInfo);

        const supervisorModelService = await config.getModelService(entry.supervisor.model, true);

        container.registerWithArgs(SupervisorAgentService, {
            [T_SupervisorSubNodes]: agentRefs,
            [T_CreateAgent]: createAgentFn,
            [T_SupervisorModelService]: supervisorModelService,
            [T_SupervisorMaxRounds]: maxRounds,
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
        const agentSubNodes = entry.agents || [];
        if (agentSubNodes.length === 0) {
            throw new Error("ReAct 模式未配置子 Agent");
        }
        if (!entry.think?.model) {
            throw new Error("ReAct 模式 think 节点未配置 model");
        }
        if (!entry.reflect?.model) {
            throw new Error("ReAct 模式 reflect 节点未配置 model");
        }

        const maxIterations = entry.maxIterations || 5;
        const systemPrompts = this.buildSystemPrompt(entry.systemPrompt, userInfo);

        const createAgentFn: CreateAgentFn = (name, subContainer) =>
            AgentFactory.create(name, subContainer, userInfo);

        const thinkModelService = await config.getModelService(entry.think.model, true);
        const reflectModelService = await config.getModelService(entry.reflect.model, true);

        container.registerWithArgs(ReActAgentService, {
            [T_AgentSubNodes]: agentSubNodes,
            [T_CreateAgent]: createAgentFn,
            [T_ThinkModelService]: thinkModelService,
            [T_ReflectModelService]: reflectModelService,
            [T_MaxIterations]: maxIterations,
            [T_SystemPrompts]: systemPrompts,
        });
        return container.resolve(ReActAgentService);
    }
}
