import { Command as CommanderCommand } from "commander";
import { CommandContext, CommandRegistry, ICommand } from "../Command";
import { GlobalLoggerService, ILogger } from "../Logger";

export enum MessageType { Command = 'command', AI = 'ai' }

interface MessageQueueItem {
  query: string;
  args: any;
}

export abstract class MessageDispatcher {
    protected messageQueue: MessageQueueItem[] = [];
    protected isProcessingQueue = false;
    protected logger?: ILogger;

    constructor() {
        this.logger = GlobalLoggerService.getLogger('MessageDispatcher.ts');
    }

    async onReceiveMessage(query: string, args: any) {
        query = query.trim()
        this.messageQueue.push({ query, args });
        this.logger?.info(`收到消息:${query} (剩余队列: ${this.messageQueue.length})`);
        if (!this.isProcessingQueue) {
            this.processMessageQueue();
        }
    }

    protected async processMessageQueue() {
        if (this.isProcessingQueue) return;
        this.isProcessingQueue = true;

        while (this.messageQueue.length > 0) {
            const { query, args } = this.messageQueue.shift()!;
            const messageType = query.startsWith('/') ? MessageType.Command : MessageType.AI;
            await this.onProcessStart(query, args, messageType);
            let error: any;
            try {
                this.logger?.info(`开始处理[${messageType}]: ${query} (剩余队列: ${this.messageQueue.length})`);
                if (messageType === MessageType.Command) {
                    await this.processCommand(query.substring(1), args);
                } else {
                    await this.processAI(query, args);
                }
                this.logger?.info(`处理完成[${messageType}]: ${query}`);
            } catch (e: any) {
                this.logger?.error(`处理出错[${messageType}]: ${query} : ${e.message}\n${e.stack}`);
                error = e;
            } finally {
                await this.onProcessEnd(query, args, messageType, error);
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
            await this.onCommandResult(allContent, args);
        }
    }
    protected abstract onProcessStart(query: string, args: any, messageType: MessageType): Promise<void>;
    protected abstract processAI(query: string, args: any): Promise<void>;
    protected abstract getAllCommands(): Promise<ICommand[]>;
    protected abstract onCommandResult(content: string, args: any): Promise<void>;
    /** 每条消息处理完毕后（无论成功或失败）调用，error 存在时表示处理出错 */
    protected abstract onProcessEnd(query: string, args: any, messageType: MessageType, error?: any): Promise<void>;
    
}
