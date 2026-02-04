import { Util } from "weimingcommons";
import { AgentService, AgentMessageChunk, AgentToolCall } from "../Agent/AgentService";
import { getLogger } from "../logger";

const logger = getLogger('UserServiceBase.ts');

interface MessageQueueItem {
  query: string;
  args: any;
}

export abstract class UserServiceBase {
    public readonly userId: string;
    private messageQueue: MessageQueueItem[] = [];
    private isProcessingQueue = false;

    constructor(userId: string) {
        this.userId = userId;
    }

    async onReceiveMessage(query: string, args: any) {
        if (Util.isNullOrEmpty(query)) return;
        // 将消息加入队列
        this.messageQueue.push({ query, args });
        logger.info(`${this.userId} 消息加入队列: ${query} (队列长度: ${this.messageQueue.length})`);
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
            try {
                logger.info(`${this.userId} 开始处理消息: ${query} (剩余队列: ${this.messageQueue.length})`);
                const agentService = new AgentService(this.userId);
                await agentService.stream(
                    query,
                    this.onAgentMessage.bind(this),
                    this.onAgentStreamMessage.bind(this),
                    this.executeAgentTool.bind(this)
                );
            } catch (e: any) {
                try {
                    logger.error(`${query}\n生成回复时出错 : ${e.message}\n${e.stack}`);
                    await this.processMessageError(e);
                } catch (e) {
                    logger.error(`处理错误时出错: ${e}`);
                }
            } finally {
                logger.info(`${this.userId} 消息处理完成: ${query}`);
            }
        }

        this.isProcessingQueue = false;
        logger.info(`${this.userId} 队列处理完成`);
    }

    abstract startProcessMessage(query: string, args: any): Promise<void>;
    abstract processMessageError(e: any): Promise<void>;
    abstract onAgentMessage(message: AgentMessageChunk): Promise<void>;
    abstract onAgentStreamMessage(message: AgentMessageChunk): Promise<void>;
    abstract executeAgentTool(toolCall: AgentToolCall): Promise<boolean>;
}