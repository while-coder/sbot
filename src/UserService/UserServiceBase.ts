import { Util } from "weimingcommons";
import { AgentService, AgentMessage, AgentToolCall, MessageChunkType } from "../Agent/AgentService";
import { LoggerService } from "../LoggerService";
import { MCPToolResult } from "../Tools/ToolsConfig";
import { Command } from "commander";
import { CommandBase, CommandContext } from "./CommandBase";
import { getBuiltInCommands } from "./BuiltInCommands";
import { config } from "../Config";
import { OpenAIModelService } from "../Model";
import { Container } from "../Core";
import { ImportanceEvaluator, MemoryCompressor, MemoryService } from "../Memory";

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
                    const modelConfig = config.getCurrentModel()!;
                    const modelService = new OpenAIModelService({
                        apiKey: modelConfig.apiKey!,
                        baseURL: modelConfig.baseURL,
                        model: modelConfig.model,
                        defaultHeaders: {
                            Authorization: `Bearer ${modelConfig.apiKey}`,
                        },
                    });
                    await modelService.initialize();
                    const container = new Container()
                    container.registerInstance(ImportanceEvaluator, new ImportanceEvaluator())
                    container.registerInstance(MemoryCompressor, new MemoryCompressor())
                    container.registerInstance(MemoryService, new MemoryService())
                    const agentService = container.resolve(AgentService);
                    // const agentService = new AgentService(this.userId, modelConfig, modelService, config.getConfigPath("skills", true));
                    await agentService.stream(
                        query,
                        this.onAgentMessage.bind(this),
                        this.onAgentStreamMessage.bind(this),
                        this.executeAgentTool.bind(this),
                        this.convertImages.bind(this)
                    );
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
            userService: this,
            args,
            // 结果回调：在命令执行后自动调用
            onResult: (result: string) => {
                commandResult = result;
            }
        };

        // 收集所有命令
        const allCommands: CommandBase[] = [
            ...getBuiltInCommands(program),
        ];

        // 注册所有命令（会自动设置 action 执行逻辑）
        for (const cmd of allCommands) {
            CommandBase.register(cmd, program, context);
        }

        // 解析命令行
        const argv = this.parseCommandLine(query);

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
        ].filter(Boolean).join('\n');

        // 如果有内容，统一调用一次 onAgentMessage 发送
        if (allContent) {
            await this.onAgentMessage({
                type: MessageChunkType.COMMAND,
                content: allContent
            });
        }
    }


    private parseCommandLine(commandLine: string): string[] {
        // 简单的命令行解析，支持引号
        const args: string[] = [];
        let current = '';
        let inQuote = false;
        let quoteChar = '';

        for (let i = 0; i < commandLine.length; i++) {
            const char = commandLine[i];

            if ((char === '"' || char === "'") && !inQuote) {
                inQuote = true;
                quoteChar = char;
            } else if (char === quoteChar && inQuote) {
                inQuote = false;
                quoteChar = '';
            } else if (char === ' ' && !inQuote) {
                if (current) {
                    args.push(current);
                    current = '';
                }
            } else {
                current += char;
            }
        }

        if (current) {
            args.push(current);
        }

        return args;
    }

    abstract startProcessMessage(query: string, args: any): Promise<void>;
    abstract processMessageError(e: any): Promise<void>;
    abstract onAgentMessage(message: AgentMessage): Promise<void>;
    abstract onAgentStreamMessage(message: AgentMessage): Promise<void>;
    abstract executeAgentTool(toolCall: AgentToolCall): Promise<boolean>;
    abstract convertImages(result: MCPToolResult): Promise<MCPToolResult>;
}