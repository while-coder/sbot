import {
    AgentServiceBase, SingleAgentService,
    IModelService,
    IMemoryService, IMemoryDatabase, MemorySqliteDatabase, MemoryEvaluator, MemoryCompressor, MemoryExtractor, MemoryService, MemoryNoneService, ReadOnlyMemoryService, MemoryMode,
    IEmbeddingService,
    IMemoryExtractor, IMemoryEvaluator, IMemoryCompressor,
    IAgentSaverService, AgentSqliteSaver, AgentMemorySaver,
} from "scorpio.ai";
import { AgentFileSaver } from "scorpio.ai/dist/Saver";
import {
    T_MaxMemoryAgeDays, T_MemoryMode, T_DBPath,
    IAgentToolService, AgentToolService,
    ISkillService, SkillService,
    ServiceContainer, T_SystemPrompts,
    ReActAgentService, T_AgentSubNodes, T_MaxIterations, T_CreateAgent, T_ThinkAgentName, T_ReflectModelService,
    SupervisorAgentService, T_SupervisorSubNodes, T_SupervisorMaxRounds, T_SupervisorAgentName, T_FinalizeModelService,
    type CreateAgentFn,
    T_ThreadId,
    T_SummaryModelService,
} from "scorpio.ai";
import { config, AgentMode, SaverType, SingleAgentEntry, ReactAgentEntry, SupervisorAgentEntry } from "./Config";
import { globalAgentToolService } from "./GlobalAgentToolService";
import { globalSkillService } from "./GlobalSkillService";


/**
 * Agent 工厂
 * 根据 AgentEntry 配置创建对应的 Agent 服务
 */
export class AgentFactory {

    static async create(
        agentName: string,
        container: ServiceContainer,
        extraPrompts?: string[],
    ): Promise<AgentServiceBase> {
        const agentEntry = config.settings.agents?.[agentName];
        if (!agentEntry) throw new Error(`Agent 配置 "${agentName}" 不存在`);

        await this.registerMemoryService(container, agentEntry.memory);
        await this.registerSaverService(container, agentEntry.saver);
        const { mcp, skills } = agentEntry as SingleAgentEntry;
        await this.registerSkillService(container, agentName, skills);
        await this.registerToolService(container, agentName, mcp);

        const systemPrompts = [...(extraPrompts ?? [])];
        if (agentEntry.systemPrompt)
            systemPrompts.push(agentEntry.systemPrompt);
        const createAgentFn: CreateAgentFn = (name, subContainer) =>
            AgentFactory.create(name, subContainer, extraPrompts);
        const agentType = agentEntry.type || AgentMode.Single;

        switch (agentType) {
            case AgentMode.ReAct:
                return this.createReAct(container, agentEntry as ReactAgentEntry, createAgentFn);

            case AgentMode.Supervisor:
                return this.createSupervisor(container, agentEntry as SupervisorAgentEntry, createAgentFn);

            case AgentMode.Single:
            default:
                return this.createSingle(container, agentEntry as SingleAgentEntry, systemPrompts);
        }
    }

    static async createMemoryService(memoryName: string): Promise<IMemoryService> {
        const container = new ServiceContainer();
        await this.registerMemoryService(container, memoryName);
        return container.resolve<IMemoryService>(IMemoryService);
    }

    static async createSaverService(saverName: string): Promise<IAgentSaverService> {
        const container = new ServiceContainer();
        await this.registerSaverService(container, saverName);
        return container.resolve<IAgentSaverService>(IAgentSaverService);
    }

    private static async registerMemoryService(
        container: ServiceContainer,
        memoryName?: string,
    ): Promise<void> {
        if (container.isRegistered(IMemoryService)) return;
        const memoryConfig = config.getMemory(memoryName);
        if (!memoryConfig?.embedding) {
            container.registerSingleton(IMemoryService, MemoryNoneService);
            return;
        }

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
            [T_ThreadId]: memoryName,
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
        if (saverConfig === undefined) {
            container.registerSingleton(IAgentSaverService, AgentMemorySaver);
            return;
        }

        if (saverConfig.type === SaverType.File) {
            container.registerWithArgs(IAgentSaverService, AgentFileSaver, {
                [T_ThreadId]: saverName,
                [T_DBPath]: config.getSaverDir(saverName!),
            });
        } else {
            container.registerWithArgs(IAgentSaverService, AgentSqliteSaver, {
                [T_ThreadId]: saverName,
                [T_DBPath]: config.getSaverPath(saverName!),
            });
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
     * 创建 Supervisor Agent
     */
    private static async createSupervisor(
        container: ServiceContainer,
        entry: SupervisorAgentEntry,
        createAgentFn: CreateAgentFn,
    ): Promise<AgentServiceBase> {
        const agentRefs = entry.agents || [];
        if (agentRefs.length === 0) {
            throw new Error("Supervisor 模式未配置 Worker Agent");
        }
        if (!entry.supervisor) {
            throw new Error("Supervisor 模式未配置 supervisor agentName");
        }
        if (!entry.summarizer) {
            throw new Error("ReAct 模式未配置 summarizer modelName");
        }
        if (!entry.finalize) {
            throw new Error("Supervisor 模式未配置 finalize modelName");
        }

        const maxRounds = entry.maxRounds || 10;
        const finalizeModelService = await config.getModelService(entry.finalize, true);
        const summarizerModelService = await config.getModelService(entry.summarizer, true);

        container.registerWithArgs(SupervisorAgentService, {
            [T_SupervisorSubNodes]: agentRefs,
            [T_CreateAgent]: createAgentFn,
            [T_SupervisorAgentName]: entry.supervisor,
            [T_SummaryModelService]: summarizerModelService,
            [T_FinalizeModelService]: finalizeModelService,
            [T_SupervisorMaxRounds]: maxRounds,
        });
        return container.resolve(SupervisorAgentService);
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
            throw new Error("ReAct 模式未配置 think agentName");
        }
        if (!entry.summarizer) {
            throw new Error("ReAct 模式未配置 summarizer modelName");
        }
        if (!entry.reflect) {
            throw new Error("ReAct 模式未配置 reflect modelName");
        }

        const maxIterations = entry.maxIterations || 5;

        const reflectModelService = await config.getModelService(entry.reflect, true);
        const summarizerModelService = await config.getModelService(entry.summarizer, true);

        container.registerWithArgs(ReActAgentService, {
            [T_AgentSubNodes]: agentSubNodes,
            [T_CreateAgent]: createAgentFn,
            [T_ThinkAgentName]: entry.think,
            [T_SummaryModelService]: summarizerModelService,
            [T_ReflectModelService]: reflectModelService,
            [T_MaxIterations]: maxIterations,
        });
        return container.resolve(ReActAgentService);
    }
}
