import "reflect-metadata";
import { Util } from "weimingcommons";
import { LarkUserServiceBase } from "winning.ai";
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
import fs from 'fs';
import * as Lark from "@larksuiteoapi/node-sdk";

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

    // 图片上传相关
    private larkClient: Lark.Client | undefined;
    private tenantAccessToken: string = '';
    private tokenExpireTime: number = 0;

    constructor(userId: string) {
        super(userId);
    }

    private getLarkClient(): Lark.Client {
        if (!this.larkClient) {
            this.larkClient = new Lark.Client({
                appId: config.settings.lark!.appId!,
                appSecret: config.settings.lark!.appSecret!,
            });
        }
        return this.larkClient;
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
                    [IModelService]: await ModelServiceFactory.getModelService(evaluatorModelConfig as any),
                });
            }

            // 知识提取器（可选）
            const extractorModelConfig = memoryConfig.extractor ? config.getModel(memoryConfig.extractor) : undefined;
            if (extractorModelConfig) {
                container.registerWithArgs(IMemoryExtractor, MemoryExtractor, {
                    [IModelService]: await ModelServiceFactory.getModelService(extractorModelConfig as any),
                });
            }

            // 记忆压缩器（可选）
            const compressorModelConfig = memoryConfig.compressor ? config.getModel(memoryConfig.compressor) : undefined;
            if (compressorModelConfig) {
                container.registerWithArgs(IMemoryCompressor, MemoryCompressor, {
                    [IModelService]: await ModelServiceFactory.getModelService(compressorModelConfig as any)
                });
            }
            // Memory 服务
            const embeddingConfig = config.getEmbedding(memoryConfig.embedding);
            if (!embeddingConfig) throw new Error(`Embedding 配置 "${memoryConfig.embedding}" 不存在`);
            container.registerWithArgs(IMemoryService, MemoryService, {
                [IEmbeddingService]: await EmbeddingServiceFactory.getEmbeddingService(embeddingConfig as any),
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
        const modelService = await ModelServiceFactory.getModelService(mainModelConfig as any);
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

    // ===== 图片上传与转换功能（sbot 特有） =====

    /**
     * 获取 tenant_access_token
     */
    private async getTenantAccessToken(): Promise<string> {
        if (this.tenantAccessToken && Util.NowDate < this.tokenExpireTime) {
            return this.tenantAccessToken;
        }

        try {
            const client = this.getLarkClient();
            const response = await client.auth.tenantAccessToken.internal({
                data: {
                    app_id: config.settings.lark!.appId!,
                    app_secret: config.settings.lark!.appSecret!,
                },
            }) as any;

            if (response.code !== 0) {
                throw new Error(`获取 tenant_access_token 失败: ${response.msg}`);
            }

            this.tenantAccessToken = response.tenant_access_token;
            this.tokenExpireTime = Util.NowDate + (response.expire - 300) * 1000;

            logger.info(`成功获取 tenant_access_token，过期时间: ${new Date(this.tokenExpireTime).toISOString()}`);
            return this.tenantAccessToken;
        } catch (error: any) {
            logger.error(`获取 tenant_access_token 失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 上传图片到飞书并获取图片 key
     */
    async uploadImageToLark(imagePath: string): Promise<string> {
        let imageBuffer: Buffer;

        try {
            if (imagePath.startsWith('data:image/')) {
                logger.info(`正在解析 base64 图片数据`);
                const base64Data = imagePath.split(',')[1];
                if (!base64Data) {
                    throw new Error('无效的 base64 图片数据格式');
                }
                imageBuffer = Buffer.from(base64Data, 'base64');
            } else {
                if (!fs.existsSync(imagePath)) {
                    throw new Error(`图片文件不存在: ${imagePath}`);
                }
                imageBuffer = fs.readFileSync(imagePath);
            }

            logger.info(`正在上传图片到飞书 (${imageBuffer.length} bytes)`);

            const token = await this.getTenantAccessToken();
            const client = this.getLarkClient();

            const response = await client.im.v1.image.create({
                data: {
                    image_type: 'message',
                    image: imageBuffer,
                },
            }, Lark.withTenantToken(token)) as any;

            if (!response || !response.image_key) {
                throw new Error(`飞书返回错误: ${response?.msg || '未知错误'}`);
            }

            const imageKey = response.image_key;
            logger.info(`图片上传成功，image_key: ${imageKey}`);

            return imageKey;
        } catch (error: any) {
            logger.error(`上传图片到飞书失败: ${error.message}\n${error.stack}`);
            throw error;
        }
    }

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

                        const imageKey = await this.uploadImageToLark(imageData);
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
