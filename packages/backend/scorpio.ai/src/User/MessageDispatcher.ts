import { Command as CommanderCommand } from "commander";
import { CommandContext, CommandRegistry, ICommand } from "../Command";
import { AgentCancelledError } from "../Agents/AgentServiceBase";
import { GlobalLoggerService, ILogger } from "../Logger";
import { ContentPartType, type MessageContent } from "../Saver/IAgentSaverService";
import { formatError } from "../Core";

export enum MessageType { Command = 'command', AI = 'ai' }

export function summarizeMultimodal(parts: Array<{ type: string; text?: string; [key: string]: any }>): string {
    const segments: string[] = [];
    for (const part of parts) {
        if (part.type === ContentPartType.Text && part.text) {
            segments.push(part.text);
        } else {
            segments.push(`[${part.type}]`);
        }
    }
    return segments.join(' ');
}

interface MessageQueueItem {
  query: MessageContent;
  args: any;
}

export abstract class MessageDispatcher {
    protected messageQueue: MessageQueueItem[] = [];
    protected isProcessingQueue = false;
    protected logger?: ILogger;

    constructor() {
        this.logger = GlobalLoggerService.getLogger('MessageDispatcher.ts');
    }

    async onReceiveMessage(query: MessageContent, args: any) {
        this.messageQueue.push({ query, args });
        if (!this.isProcessingQueue) {
            this.processMessageQueue();
        }
    }

    protected async processMessageQueue() {
        if (this.isProcessingQueue) return;
        this.isProcessingQueue = true;

        try {
            while (this.messageQueue.length > 0) {
                const { query, args } = this.messageQueue.shift()!;
                const queryText = typeof query === 'string' ? query : summarizeMultimodal(query);
                const messageType = typeof query === 'string' && query.trimStart().startsWith('/') ? MessageType.Command : MessageType.AI;
                let logSuffix = '';
                let error: any;
                try {
                    const startLabel = await this.onProcessStart(query, args, messageType);
                    logSuffix = startLabel != null ? `(${startLabel})` : '';
                    this.logger?.info(`开始处理[${logSuffix}]: ${queryText} (剩余队列: ${this.messageQueue.length})`);
                    if (messageType === MessageType.Command) {
                        await this.processCommand(query as string, args);
                    } else {
                        await this.processAI(query, args);
                    }
                    this.logger?.info(`处理完成[${logSuffix}]: ${queryText}`);
                } catch (e: any) {
                    if (e instanceof AgentCancelledError) {
                        this.logger?.info(`处理已取消[${logSuffix}]: ${queryText}`);
                    } else {
                        this.logger?.error(`处理出错[${logSuffix}]: ${queryText} : ${formatError(e, true)}`);
                    }
                    error = e;
                } finally {
                    try {
                        await this.onProcessEnd(query, args, messageType, error);
                    } catch (e: any) {
                        this.logger?.error(`结束处理出错: ${queryText} : ${formatError(e, true)}`);
                    }
                }
            }
        } finally {
            this.isProcessingQueue = false;
        }
    }


    private async processCommand(query: string, args: any): Promise<void> {
        const program = new CommanderCommand();

        const outputs: string[] = [];
        const errors: string[] = [];

        program.exitOverride();
        program.configureOutput({
            writeOut: (str) => outputs.push(str),
            writeErr: (str) => errors.push(str),
            outputError: (str, write) => write(str),
        });

        let commandResult: string | undefined;

        const context: CommandContext = {
            context: this,
            args,
            onResult: (result: string) => {
                commandResult = result;
            }
        };

        const allCommands = await this.getAllCommands();
        for (const cmd of allCommands) {
            CommandRegistry.register(cmd, program, context);
        }

        const stripped = query.startsWith('/') ? query.substring(1) : query;
        const argv = CommandRegistry.parse(stripped);

        try {
            await program.parseAsync(argv, { from: 'user' });
        } catch (err: any) {
            if (!err.code || !err.code.startsWith('commander.')) {
                throw err;
            }
        }

        if (commandResult == undefined && outputs.length === 0 && errors.length === 0) {
            const cmdName = argv[0] || '';
            throw new Error(`Unknown command: ${cmdName}\nType /help to see available commands`);
        }

        const allContent = [
            ...errors,
            ...outputs,
            commandResult
        ].join('\n');

        if (allContent) {
            await this.onCommandResult(query, allContent, args);
        }
    }
    protected abstract onProcessStart(query: MessageContent, args: any, messageType: MessageType): Promise<string | void>;
    protected abstract processAI(query: MessageContent, args: any): Promise<void>;
    protected abstract getAllCommands(): Promise<ICommand[]>;
    protected abstract onCommandResult(query: string, content: string, args: any): Promise<void>;
    /** 每条消息处理完毕后（无论成功或失败）调用，error 存在时表示处理出错 */
    protected abstract onProcessEnd(query: MessageContent, args: any, messageType: MessageType, error?: any): Promise<void>;
    
}
