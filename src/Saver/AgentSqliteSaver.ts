import { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { AIMessage, AIMessageChunk, BaseMessage, ToolMessage } from "langchain";
import { IAgentSaverService } from "./IAgentSaverService";
import { LoggerService } from "../LoggerService";

const logger = LoggerService.getLogger("AgentSqliteSaver.ts");

/**
 * 基于 SQLite 的 Agent Saver 实现
 * 使用 SQLite 数据库持久化对话历史
 */
export class AgentSqliteSaver implements IAgentSaverService {
    private saver: SqliteSaver | undefined;
    private maxTokens: number = 8000;

    constructor(private dbPath: string) {
        this.saver = SqliteSaver.fromConnString(this.dbPath);
    }

    /**
     * 获取 LangGraph 的 CheckpointSaver 实例
     */
    async getCheckpointer(): Promise<BaseCheckpointSaver> {
        return this.saver!;
    }

    /**
     * 清除指定线程的所有历史记录
     */
    async clearThread(threadId: string): Promise<void> {
        try {
            await this.saver?.deleteThread(threadId);
        } catch (error: any) {
            if (error.message?.includes('no such table')) {
                return;
            }
            throw error;
        }
    }

    /**
     * 获取指定线程的历史消息
     */
    async getMessages(threadId: string): Promise<BaseMessage[]> {
        try {
            const currentState = await this.saver?.get({ configurable: { thread_id: threadId } });

            if (currentState?.channel_values) {
                const channelValues = currentState.channel_values as any;

                if (channelValues.messages && Array.isArray(channelValues.messages)) {
                    return channelValues.messages;
                }
            }

            return [];
        } catch (error: any) {
            logger.warn(`获取线程 ${threadId} 历史消息失败: ${error.message}`);
            return [];
        }
    }

    /**
     * 准备历史记录用于 stream
     * 如果历史 token 超限，返回截断后的历史消息并清理 saver
     * 否则返回空数组（使用 saver 中的历史）
     */
    async prepareHistory(threadId: string): Promise<BaseMessage[]> {
        try {
            const allMessages = await this.getMessages(threadId);
            const totalTokens = this.estimateTotalTokens(allMessages);

            if (totalTokens > this.maxTokens) {
                const recentMessages = this.truncateMessages(allMessages, this.maxTokens);

                await this.clearThread(threadId);

                logger.warn(`线程 ${threadId} 历史约 ${totalTokens} tokens 超限(${this.maxTokens})，截断为 ${recentMessages.length} 条消息`);
                return recentMessages;
            }

            return [];
        } catch (error: any) {
            logger.error(`线程 ${threadId} 准备历史记录失败: ${error.message}`);
            return [];
        }
    }

    /**
     * 基于 token 限制截断消息，从末尾向前保留，确保不破坏 tool_calls 配对
     */
    truncateMessages(messages: BaseMessage[], maxTokens: number): BaseMessage[] {
        let tokenCount = 0;
        let startIndex = messages.length;

        // 从末尾向前累加 token
        for (let i = messages.length - 1; i >= 0; i--) {
            const msgTokens = this.estimateMessageTokens(messages[i]);
            if (tokenCount + msgTokens > maxTokens) {
                break;
            }
            tokenCount += msgTokens;
            startIndex = i;
        }

        // 调整截断点，确保不破坏 tool_calls 和 ToolMessage 的配对
        startIndex = this.adjustStartIndex(messages, startIndex);

        return messages.slice(startIndex);
    }

    /**
     * 调整截断起始位置，确保不切断 tool_calls → ToolMessage 配对
     * 如果起始位置落在 ToolMessage 上或落在带 tool_calls 的 AI 消息的 ToolMessage 序列中间，
     * 则向前找到完整配对的起点，或向后跳过整个配对
     */
    private adjustStartIndex(messages: BaseMessage[], startIndex: number): number {
        if (startIndex >= messages.length) return startIndex;

        const msg = messages[startIndex];

        // 如果起始位置是 ToolMessage，向后跳过直到非 ToolMessage
        if (msg instanceof ToolMessage) {
            for (let i = startIndex; i < messages.length; i++) {
                if (!(messages[i] instanceof ToolMessage)) {
                    return i;
                }
            }
            return messages.length;
        }

        // 如果起始位置是带 tool_calls 的 AI 消息，确保其后续 ToolMessage 都被包含
        if ((msg instanceof AIMessage || msg instanceof AIMessageChunk) && msg.tool_calls?.length) {
            // 检查后续 ToolMessage 是否都在范围内（已经是从 startIndex 开始，所以一定包含）
            // 这种情况是安全的，不需要调整
            return startIndex;
        }

        return startIndex;
    }

    private estimateMessageTokens(message: BaseMessage): number {
        const content = message.content;
        let textLength = 0;

        if (typeof content === 'string') {
            textLength = content.length;
        } else if (Array.isArray(content)) {
            for (const part of content as any[]) {
                if (typeof part === 'string') {
                    textLength += part.length;
                } else if (part && typeof part === 'object' && 'text' in part) {
                    textLength += part.text?.length ?? 0;
                }
            }
        }

        // tool_calls 也占 token
        if ((message instanceof AIMessage || message instanceof AIMessageChunk) && message.tool_calls?.length) {
            for (const tc of message.tool_calls) {
                textLength += (tc.name?.length ?? 0) + JSON.stringify(tc.args ?? {}).length;
            }
        }

        // 粗略估算：中文 ~1.5 token/字，英文 ~0.25 token/字，取平均 ~0.75 token/字
        // 加上消息头开销（role 等约 4 token）
        return Math.ceil(textLength * 0.75) + 4;
    }

    private estimateTotalTokens(messages: BaseMessage[]): number {
        let total = 0;
        for (const msg of messages) {
            total += this.estimateMessageTokens(msg);
        }
        return total;
    }

    /**
     * 释放资源
     */
    async dispose(): Promise<void> {
        if (this.saver) {
            try {
                // @ts-ignore - SqliteSaver 可能有 db 属性用于访问底层数据库
                if (this.saver.db && typeof this.saver.db.close === 'function') {
                    await this.saver.db.close();
                }
            } catch (error: any) {
                logger.error(`AgentSqliteSaver 释放失败: ${error.message}`);
            } finally {
                this.saver = undefined;
            }
        }
    }
}
