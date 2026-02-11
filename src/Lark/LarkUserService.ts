import "reflect-metadata";
import { LarkUserServiceBase, larkService } from "winning.ai";
import {
    AgentService, 
    IAgentSaverService, AgentSqliteSaver, IAgentToolService, AgentToolService,
    IModelService, ModelServiceFactory,
    IMemoryService, MemoryEvaluator, MemoryCompressor, MemoryExtractor, MemoryService,
    IEmbeddingService, EmbeddingServiceFactory,
    ServiceContainer,
    ISkillService, SkillService,
    ICommand,
    MCPToolResult, MCPContentType,
    IMemoryExtractor,
    IMemoryEvaluator,
    IMemoryCompressor,
} from "scorpio.ai";
import { SupervisorService, ReActService, AgentConfig } from "../Plan/index.js";
import { LoggerService } from "../LoggerService";
import { getBuiltInCommands } from "../UserService/BuiltInCommands";
import { config } from "../Config";

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
                [IEmbeddingService]: await EmbeddingServiceFactory.getEmbeddingService(embeddingConfig),
                "UserId": this.userId,
                "DBPath": config.getUserMemoryPath(this.userId),
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

        // 读取 Plan 配置
        const planConfig = config.settings.plan || {};
        const planMode = planConfig.mode || "single"; // single | supervisor | react
        const agentConfigs: AgentConfig[] = (planConfig.agents || []) as AgentConfig[];
        const maxIterations = planConfig.maxIterations || 5;

        // 根据配置选择模式
        if (planMode === "supervisor" && agentConfigs.length > 0) {
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
                this.onAgentMessage.bind(this),
                this.onAgentStreamMessage.bind(this),
                undefined, // onTaskStatusChange
                undefined, // onPlanCreated
                this.executeAgentTool.bind(this),
                this.convertImages.bind(this)
            );
        } else if (planMode === "react" && agentConfigs.length > 0) {
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
                this.onAgentMessage.bind(this),
                this.onAgentStreamMessage.bind(this),
                this.executeAgentTool.bind(this),
                this.convertImages.bind(this)
            );
        } else {
            // 单 Agent 模式（默认，向后兼容）
            logger.info(`${this.userId} 使用单 Agent 模式`);

            container.registerWithArgs(AgentService, {
                userId: this.userId,
                threadId: this.userId,
            });
            const agentService = await container.resolve(AgentService);

            await agentService.stream(
                query,
                this.onAgentMessage.bind(this),
                this.onAgentStreamMessage.bind(this),
                this.executeAgentTool.bind(this),
                this.convertImages.bind(this)
            );
        }
    }

    // ===== 图片转换功能 =====

    /**
     * 转换 MCP 格式结果中的图片为飞书图片格式
     */
    async convertImages(result: MCPToolResult): Promise<MCPToolResult> {
        try {
            const convertedResult: MCPToolResult = {
                content: [],
                isError: result.isError,
            };

            for (const contentItem of result.content) {
                if (contentItem.type === MCPContentType.Image || contentItem.type === MCPContentType.ImageUrl) {
                    try {
                        let imageData: string;
                        if (contentItem.type === MCPContentType.Image) {
                            imageData = contentItem.data;
                        } else {
                            const urlField = contentItem.url || contentItem.image_url;
                            if (!urlField) {
                                throw new Error('图片 URL 字段为空');
                            }
                            imageData = typeof urlField === 'string' ? urlField : urlField.url;
                        }

                        if (imageData.startsWith('http://') || imageData.startsWith('https://')) {
                            logger.info(`跳过 HTTP/HTTPS 图片 URL: ${imageData}`);
                            convertedResult.content.push(contentItem);
                            continue;
                        }

                        const imageKey = await larkService.uploadImageToLark(imageData);
                        convertedResult.content.push({
                            type: MCPContentType.Text,
                            text: `![](${imageKey})`
                        });
                        logger.info(`已转换图片内容到飞书格式`);
                    } catch (error: any) {
                        logger.error(`转换图片失败: ${error.message}`);
                        convertedResult.content.push(contentItem);
                    }
                } else {
                    convertedResult.content.push(contentItem);
                }
            }

            return convertedResult;
        } catch (error: any) {
            logger.error(`MCP 图片转换过程出错: ${error.message}`);
            return result;
        }
    }
}
