import { Util } from "weimingcommons";
import {
    AgentService, AgentMessage, AgentToolCall, MessageChunkType,
    IAgentSaverService, AgentSqliteSaver, IAgentToolService, AgentToolService,
    IModelService, ModelServiceFactory,
    IMemoryService, MemoryEvaluator, MemoryCompressor, MemoryExtractor, MemoryService,
    IEmbeddingService, EmbeddingServiceFactory,
    ServiceContainer,
    ISkillService, SkillService,
    ICommand,
    CommandContext,
    CommandRegistry,
    MCPToolResult,
    IMemoryExtractor,
    IMemoryEvaluator,
    IMemoryCompressor,
} from "scorpio.ai";
import { SupervisorService, ReActService, AgentConfig } from "../Plan/index.js";
import { LoggerService } from "../LoggerService";
import { Command } from "commander";
import { getBuiltInCommands } from "./BuiltInCommands";
import { config } from "../Config";

const logger = LoggerService.getLogger('UserServiceBase.ts');

interface MessageQueueItem {
  query: string;
  args: any;
}

export abstract class UserServiceBase {
    public readonly userId: string;
    public messageQueue: MessageQueueItem[] = [];  // 改为 public 以便命令访问
    private isProcessingQueue = false;

    constructor(userId: string) {
        this.userId = userId;
    }

    async onReceiveMessage(query: string, args: any) {
        query = query.trim()
        if (Util.isNullOrEmpty(query)) return;
        // 将消息加入队列
        this.messageQueue.push({ query, args });
        // 如果没有正在处理队列，启动处理
        if (!this.isProcessingQueue) {
            this.processMessageQueue();
        }
    }

    private async processMessageQueue() {
        if (this.isProcessingQueue) return;
        this.isProcessingQueue = true;

        while (this.messageQueue.length > 0) {
            const messageItem = this.messageQueue.shift()!;
            const { query, args } = messageItem;

            // 每次处理消息时创建新的 agentService
            await this.startProcessMessage(query, args);
            const messageType = query.startsWith('/') ? '命令' : '消息';
            try {
                logger.info(`${this.userId} 开始处理${messageType}: ${query} (剩余队列: ${this.messageQueue.length})`);
                // 检查是否是命令（以 "/" 开头）
                if (query.startsWith('/')) {
                    await this.processCommand(query.substring(1), args);
                } else {
                    await this.processAIMessage(query, args)
                }
                logger.info(`${this.userId} ${messageType}处理完成: ${query}`);
            } catch (e: any) {
                logger.error(`${this.userId} ${messageType}处理出错: ${query} : ${e.message}\n${e.stack}`);
                try {
                    await this.processMessageError(e);
                } catch (errorHandlingError) {
                    // 忽略错误处理中的错误
                }
            }
        }
        this.isProcessingQueue = false;
    }

    private async processCommand(query: string, args: any) {
        const program = new Command();

        // 保存所有输出
        const outputs: string[] = [];
        const errors: string[] = [];

        // 禁用默认的帮助和版本命令
        program.exitOverride(); // 防止 commander 退出进程
        program.configureOutput({
            writeOut: (str) => outputs.push(str),
            writeErr: (str) => errors.push(`❌ ${str}`),
            outputError: (str, write) => write(str),
        });

        let commandResult: string | undefined;

        // 创建命令上下文（带结果回调）
        const context: CommandContext = {
            context: this,
            args,
            // 结果回调：在命令执行后自动调用
            onResult: (result: string) => {
                commandResult = result;
            }
        };

        // 收集所有命令
        const allCommands: ICommand[] = [
            ...getBuiltInCommands(program),
        ];

        // 注册所有命令（会自动设置 action 执行逻辑）
        for (const cmd of allCommands) {
            CommandRegistry.register(cmd, program, context);
        }

        // 解析命令行
        const argv = CommandRegistry.parse(query);

        try {
            // 直接让 Commander 解析并执行命令
            await program.parseAsync(argv, { from: 'user' });
        } catch (err: any) {
            // 只处理非 Commander 错误（Commander 错误已通过 configureOutput 处理）
            if (!err.code || !err.code.startsWith('commander.')) {
                // 非 Commander 错误，重新抛出
                throw err;
            }
        }

        // 如果没有匹配的命令且没有输出内容，抛出错误
        if (!commandResult && outputs.length === 0 && errors.length === 0) {
            const cmdName = argv[0] || '';
            throw new Error(`未知命令: ${cmdName}\n输入 /help 查看可用命令`);
        }

        // 合并所有输出：错误 + 普通输出 + 命令结果
        const allContent = [
            ...errors,
            ...outputs,
            commandResult
        ].join('\n');

        // 如果有内容，统一调用一次 onAgentMessage 发送
        if (allContent) {
            await this.onAgentMessage({
                type: MessageChunkType.COMMAND,
                content: allContent
            });
        }
    }
    private async processAIMessage(query: string, args: any) {
        // 创建 DI 容器并注册服务
        const container = new ServiceContainer();

        // 可选：注册记忆相关依赖（需要 memory.embedding 配置才启用）
        const memoryConfig = config.settings.memory;
        if (memoryConfig?.enabled && memoryConfig?.embedding) {
            // 重要性评估器（可选）
            if (memoryConfig.evaluator) {
                container.registerWithArgs(IMemoryEvaluator, MemoryEvaluator, {
                    [IModelService]: await ModelServiceFactory.getModelService(memoryConfig.evaluator),
                });
            }

            // 知识提取器（可选）
            if (memoryConfig.extractor) {
                container.registerWithArgs(IMemoryExtractor, MemoryExtractor, {
                    [IModelService]: await ModelServiceFactory.getModelService(memoryConfig.extractor),
                });
            }

            // 记忆压缩器（可选）
            if (memoryConfig.compressor) {
                container.registerWithArgs(IMemoryCompressor, MemoryCompressor, {
                    [IModelService]: await ModelServiceFactory.getModelService(memoryConfig.compressor)
                });
            }
            // Memory 服务
            container.registerWithArgs(IMemoryService, MemoryService, {
                [IEmbeddingService]: await EmbeddingServiceFactory.getEmbeddingService(memoryConfig.embedding),
                "UserId": this.userId,
                "DBPath": config.getUserMemoryPath(this.userId),
                "MaxMemoryAgeDays": memoryConfig.maxAgeDays
            });
        }

        // 日志服务（注册全局实例，AgentService 会自动使用）
        // GlobalLoggerService 已在 LoggerService.ts 中配置，这里不需要额外注册

        // 技能服务
        container.registerWithArgs(ISkillService, SkillService, {
            SkillsDirs: [config.getConfigPath("skills")]
        });

        // 模型服务（使用静态方法）
        const modelService = await ModelServiceFactory.getModelService(config.getModelName());
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
            // ReAct 模式：思考 → 行动 → 观察，迭代决策
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

    abstract startProcessMessage(query: string, args: any): Promise<void>;
    abstract processMessageError(e: any): Promise<void>;
    abstract onAgentMessage(message: AgentMessage): Promise<void>;
    abstract onAgentStreamMessage(message: AgentMessage): Promise<void>;
    abstract executeAgentTool(toolCall: AgentToolCall): Promise<boolean>;
    abstract convertImages(result: MCPToolResult): Promise<MCPToolResult>;
}