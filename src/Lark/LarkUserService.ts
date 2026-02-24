import "reflect-metadata";
import { LarkUserServiceBase, larkService } from "winning.ai";
import {
    AgentService,
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
} from "scorpio.ai";
import { SupervisorService, ReActService, AgentConfig } from "../Plan/index.js";
import { LoggerService } from "../LoggerService";
import { getBuiltInCommands } from "../UserService/BuiltInCommands";
import { config, PlanMode } from "../Config";

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
                "UserId": this.userId,
                [IEmbeddingService]: await EmbeddingServiceFactory.getEmbeddingService(embeddingConfig),
                [IMemoryDatabase]: new MemoryDatabase(config.getUserMemoryPath(this.userId)),
                "MaxMemoryAgeDays": memoryConfig.maxAgeDays
            });
        }

        // 技能服务
        container.registerWithArgs(ISkillService, SkillService, {
            SkillsDirs: [config.getConfigPath("skills")]
        });

        // 模型服务
        const mainModelConfig = config.getModel(config.getModelName());
        if (!mainModelConfig) throw new Error(`模型配置 "${config.getModelName()}" 不存在`);
        const modelService = await ModelServiceFactory.getModelService(mainModelConfig);
        container.registerInstance(IModelService, modelService);

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

        // 读取 Plan 配置
        const planConfig = config.settings.plan || {};
        const planMode = planConfig.mode || PlanMode.Single;

        // 根据配置选择模式
        if (planMode === PlanMode.Supervisor) {
            const supervisorConfig = planConfig.supervisor;
            const agentConfigs: AgentConfig[] = (supervisorConfig?.agents || []) as AgentConfig[];
            if (agentConfigs.length === 0) {
                logger.warn(`${this.userId} Supervisor 模式未配置 Agent，降级为 Single 模式`);
            } else {
                // Supervisor 模式：预先规划所有任务，按依赖顺序执行
                logger.info(`${this.userId} 使用 Supervisor 模式，包含 ${agentConfigs.length} 个 Agent`);

                container.registerWithArgs(SupervisorService, {
                    userId: this.userId,
                    threadId: this.userId,
                    agentConfigs,
                });
                const supervisorService = await container.resolve(SupervisorService);

                await supervisorService.stream(
                    query,
                    {
                        onMessage: this.onAgentMessage.bind(this),
                        onStreamMessage: this.onAgentStreamMessage.bind(this),
                        executeTool: this.executeAgentTool.bind(this),
                        convertImages: this.convertImages.bind(this),
                    }
                );
                return;
            }
        } else if (planMode === PlanMode.ReAct) {
            const reactConfig = planConfig.react;
            const agentConfigs: AgentConfig[] = (reactConfig?.agents || []) as AgentConfig[];
            const maxIterations = reactConfig?.maxIterations || 5;
            if (agentConfigs.length === 0) {
                logger.warn(`${this.userId} ReAct 模式未配置 Agent，降级为 Single 模式`);
            } else {
                // ReAct 模式：思考 -> 行动 -> 观察，迭代决策
                logger.info(`${this.userId} 使用 ReAct 模式，包含 ${agentConfigs.length} 个 Agent，最大迭代 ${maxIterations} 次`);

                container.registerWithArgs(ReActService, {
                    userId: this.userId,
                    threadId: this.userId,
                    agentConfigs,
                    maxIterations,
                });
                const reactService = await container.resolve(ReActService);

                await reactService.stream(
                    query,
                    {
                        onMessage: this.onAgentMessage.bind(this),
                        onStreamMessage: this.onAgentStreamMessage.bind(this),
                        executeTool: this.executeAgentTool.bind(this),
                        convertImages: this.convertImages.bind(this),
                    }
                );
                return;
            }
        }

        // 单 Agent 模式（默认，或多 Agent 模式降级）
        logger.info(`${this.userId} 使用单 Agent 模式`);

        container.registerWithArgs(AgentService, {
            threadId: this.userId,
        });
        const agentService = await container.resolve(AgentService);

        await agentService.stream(
            query,
            {
                onMessage: this.onAgentMessage.bind(this),
                onStreamMessage: this.onAgentStreamMessage.bind(this),
                executeTool: this.executeAgentTool.bind(this),
                convertImages: this.convertImages.bind(this),
            }
        );
    }
}
