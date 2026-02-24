import "reflect-metadata";
import { LarkUserServiceBase, larkService } from "winning.ai";
import {
    IAgentSaverService, AgentSqliteSaver, IAgentToolService, AgentToolService,
    IModelService, ModelServiceFactory,
    IMemoryService, IMemoryDatabase, MemoryDatabase, MemoryEvaluator, MemoryCompressor, MemoryExtractor, MemoryService,
    IEmbeddingService, EmbeddingServiceFactory,
    ServiceContainer,
    ISkillService, SkillService,
    ICommand,
    IMemoryExtractor,
    IMemoryEvaluator,
    IMemoryCompressor,
    T_UserId,
    T_MaxMemoryAgeDays,
    T_MemoryMode,
    T_SkillsDirs,
} from "scorpio.ai";
import { LoggerService } from "../LoggerService";
import { getBuiltInCommands } from "../UserService/BuiltInCommands";
import { config } from "../Config";
import { AgentFactory } from "../AgentFactory";

const logger = LoggerService.getLogger('LarkUserService.ts');

export class LarkUserService extends LarkUserServiceBase {
    static allUsers = new Map<string, LarkUserService>();
    static getUserAgentService(userId: string): LarkUserService {
        if (LarkUserService.allUsers.has(userId)) {
            return LarkUserService.allUsers.get(userId)!;
        }
        const user = new LarkUserService(userId);
        LarkUserService.allUsers.set(userId, user);
        return user;
    }

    constructor(userId: string) {
        super(userId);
    }

    protected async getAllCommands(): Promise<ICommand[]> {
        return getBuiltInCommands();
    }

    protected async processAIMessage(query: string, args: any): Promise<void> {
        // 创建 DI 容器并注册服务
        const container = new ServiceContainer();

        // 可选：注册记忆相关依赖（需要 memory.embedding 配置才启用）
        const memoryConfig = config.settings.memory;
        if (memoryConfig?.enabled && memoryConfig?.embedding) {
            // 重要性评估器（可选）
            const evaluatorModelConfig = memoryConfig.evaluator ? config.getModel(memoryConfig.evaluator) : undefined;
            if (evaluatorModelConfig) {
                container.registerWithArgs(IMemoryEvaluator, MemoryEvaluator, {
                    [IModelService]: await ModelServiceFactory.getModelService(evaluatorModelConfig),
                });
            }

            // 知识提取器（可选）
            const extractorModelConfig = memoryConfig.extractor ? config.getModel(memoryConfig.extractor) : undefined;
            if (extractorModelConfig) {
                container.registerWithArgs(IMemoryExtractor, MemoryExtractor, {
                    [IModelService]: await ModelServiceFactory.getModelService(extractorModelConfig),
                });
            }

            // 记忆压缩器（可选）
            const compressorModelConfig = memoryConfig.compressor ? config.getModel(memoryConfig.compressor) : undefined;
            if (compressorModelConfig) {
                container.registerWithArgs(IMemoryCompressor, MemoryCompressor, {
                    [IModelService]: await ModelServiceFactory.getModelService(compressorModelConfig)
                });
            }
            // Memory 服务
            const embeddingConfig = config.getEmbedding(memoryConfig.embedding);
            if (!embeddingConfig) throw new Error(`Embedding 配置 "${memoryConfig.embedding}" 不存在`);
            container.registerWithArgs(IMemoryService, MemoryService, {
                [T_UserId]: this.userId,
                [IEmbeddingService]: await EmbeddingServiceFactory.getEmbeddingService(embeddingConfig),
                [IMemoryDatabase]: new MemoryDatabase(config.getUserMemoryPath(this.userId)),
                [T_MaxMemoryAgeDays]: memoryConfig.maxAgeDays,
                [T_MemoryMode]: memoryConfig.mode,
            });
        }

        // 技能服务
        container.registerWithArgs(ISkillService, SkillService, {
            [T_SkillsDirs]: [config.getConfigPath("skills")]
        });

        // Agent Saver 服务（使用 AgentSqliteSaver 实现）
        container.registerWithArgs(IAgentSaverService, AgentSqliteSaver, {
            DBPath: config.getUserSaverPath(this.userId)
        });

        // Agent 工具服务
        container.registerSingleton(IAgentToolService, AgentToolService);

        // 加载 MCP 服务器配置
        const agentToolService = await container.resolve<AgentToolService>(IAgentToolService);
        const mcpServers = config.getMcpServers();
        if (Object.keys(mcpServers).length > 0) {
            await agentToolService.addMcpServers(mcpServers);
        }
        const builtinMcpServers = config.getBuiltinMcpServers();
        if (Object.keys(builtinMcpServers).length > 0) {
            await agentToolService.addMcpServers(builtinMcpServers);
        }

        // 读取 Agent 配置
        const agentName = config.settings.agent;
        if (!agentName) throw new Error("未配置 agent，请在 settings.json 中设置 agent 字段");
        const agentEntry = config.settings.agents?.[agentName];
        if (!agentEntry) throw new Error(`Agent 配置 "${agentName}" 不存在，请检查 settings.json 中的 agents 配置`);

        logger.info(`${this.userId} 使用 Agent [${agentName}] (${agentEntry.type})`);

        // 通过 AgentFactory 创建 Agent 服务
        const agent = await AgentFactory.create(container, agentEntry, this.userId, this.userInfo);

        await agent.stream(query, {
            onMessage: this.onAgentMessage.bind(this),
            onStreamMessage: this.onAgentStreamMessage.bind(this),
            executeTool: this.executeAgentTool.bind(this),
            convertImages: this.convertImages.bind(this),
        });
    }
}
