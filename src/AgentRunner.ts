import {
    IModelService, ModelServiceFactory,
    IMemoryService, IMemoryDatabase, MemoryDatabase, MemoryEvaluator, MemoryCompressor, MemoryExtractor, MemoryService,
    IEmbeddingService, EmbeddingServiceFactory,
    IAgentSaverService, AgentSqliteSaver,
    ServiceContainer,
    IMemoryExtractor,
    IMemoryEvaluator,
    IMemoryCompressor,
    T_UserId,
    T_MaxMemoryAgeDays,
    T_MemoryMode,
    T_DBPath,
    IAgentCallback,
} from "scorpio.ai";
import { config } from "./Config";
import { AgentFactory } from "./AgentFactory";
import { LoggerService } from "./LoggerService";

const logger = LoggerService.getLogger('AgentRunner.ts');

export class AgentRunner {
    static async run(
        userId: string,
        query: string,
        callbacks: IAgentCallback,
        userInfo?: any,
    ): Promise<void> {
        const agentName = config.settings.agent;
        if (!agentName) throw new Error("未配置 agent，请在 settings.json 中设置 agent 字段");
        const agentEntry = config.settings.agents?.[agentName];
        if (!agentEntry) throw new Error(`Agent 配置 "${agentName}" 不存在，请检查 settings.json 中的 agents 配置`);

        const container = new ServiceContainer();

        const memoryConfig = config.settings.memory;
        if (memoryConfig?.enabled && memoryConfig?.embedding) {
            const evaluatorModelConfig = memoryConfig.evaluator ? config.getModel(memoryConfig.evaluator) : undefined;
            if (evaluatorModelConfig) {
                container.registerWithArgs(IMemoryEvaluator, MemoryEvaluator, {
                    [IModelService]: await ModelServiceFactory.getModelService(evaluatorModelConfig),
                });
            }
            const extractorModelConfig = memoryConfig.extractor ? config.getModel(memoryConfig.extractor) : undefined;
            if (extractorModelConfig) {
                container.registerWithArgs(IMemoryExtractor, MemoryExtractor, {
                    [IModelService]: await ModelServiceFactory.getModelService(extractorModelConfig),
                });
            }
            const compressorModelConfig = memoryConfig.compressor ? config.getModel(memoryConfig.compressor) : undefined;
            if (compressorModelConfig) {
                container.registerWithArgs(IMemoryCompressor, MemoryCompressor, {
                    [IModelService]: await ModelServiceFactory.getModelService(compressorModelConfig),
                });
            }
            const embeddingConfig = config.getEmbedding(memoryConfig.embedding);
            if (!embeddingConfig) throw new Error(`Embedding 配置 "${memoryConfig.embedding}" 不存在`);
            container.registerWithArgs(IMemoryService, MemoryService, {
                [T_UserId]: userId,
                [IEmbeddingService]: await EmbeddingServiceFactory.getEmbeddingService(embeddingConfig),
                [IMemoryDatabase]: new MemoryDatabase(config.getUserMemoryPath(userId)),
                [T_MaxMemoryAgeDays]: memoryConfig.maxAgeDays,
                [T_MemoryMode]: memoryConfig.mode,
            });
        }

        container.registerWithArgs(IAgentSaverService, AgentSqliteSaver, {
            [T_DBPath]: config.getUserSaverPath(userId),
        });

        logger.info(`${userId} 使用 Agent [${agentName}] (${agentEntry.type})`);

        const agent = await AgentFactory.create(container, agentEntry, userId, agentName, userInfo);
        await agent.stream(query, callbacks);
    }
}
