import { Command as CommanderCommand } from "commander";
import { CommandContext, CommandRegistry, ICommand, SaverContext } from "../Command";
import { GlobalLoggerService, ILogger } from "../Logger";

export enum MessageType { Command = 'command', AI = 'ai' }

interface MessageQueueItem {
  query: string;
  args: any;
  resolve?: () => void;
}

export abstract class UserServiceBase {
    protected messageQueue: MessageQueueItem[] = [];
    protected isProcessingQueue = false;
    protected logger?: ILogger;

    constructor() {
        this.logger = GlobalLoggerService.getLogger('UserServiceBase.ts');
    }

    async onReceiveMessage(query: string, args: any, resolve?: () => void) {
        query = query.trim()
        // 将消息加入队列
        this.messageQueue.push({ query, args, resolve });
        // 如果没有正在处理队列，启动处理
        if (!this.isProcessingQueue) {
            this.processMessageQueue();
        }
    }

    protected async processMessageQueue() {
        if (this.isProcessingQueue) return;
        this.isProcessingQueue = true;

        while (this.messageQueue.length > 0) {
            const messageItem = this.messageQueue.shift()!;
            const { query, args } = messageItem;

            const messageType = query.startsWith('/') ? MessageType.Command : MessageType.AI;
            let messagePrompt = await this.startProcessMessage(query, args, messageType);
            try {
                this.logger?.info(`开始处理[${messageType}]: ${query} (${messagePrompt})(剩余队列: ${this.messageQueue.length})`);
                if (messageType === MessageType.Command) {
                    await this.processCommand(query.substring(1), args);
                } else {
                    await this.processAIMessage(query, args);
                }
                this.logger?.info(`处理完成[${messageType}]: ${query}`);
            } catch (e: any) {
                this.logger?.error(`处理出错[${messageType}]: ${query} : ${e.message}\n${e.stack}`);
                try {
                    await this.processMessageError(e, args, messageType);
                } catch (errorHandlingError) {
                    // 忽略错误处理中的错误
                }
            } finally {
                await this.onMessageProcessed(query, args, messageType);
                messageItem.resolve?.();
            }
        }
        this.isProcessingQueue = false;
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

        const argv = CommandRegistry.parse(query);

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
            await this.onCommandOutput(allContent, args);
        }
    }
    protected abstract startProcessMessage(query: string, args: any, messageType: MessageType): Promise<string>;
    protected abstract getAllCommands():Promise<ICommand[]>
    protected abstract processAIMessage(query: string, args: any): Promise<void>;
    protected abstract onCommandOutput(content: string, args: any): Promise<void>;
    
    protected abstract processMessageError(e: any, args: any, messageType: MessageType): Promise<void>;
    /** 每条消息处理完毕后（无论成功或失败）调用，子类可覆盖以做清理 */
    protected async onMessageProcessed(_query: string, _args: any, _messageType: MessageType): Promise<void> {}
    
}
