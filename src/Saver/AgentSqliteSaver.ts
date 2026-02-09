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
    private maxHistoryMessages: number = 10;

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
     * 如果历史记录超过限制，返回截断后的历史消息并清理 saver
     * 否则返回空数组（使用 saver 中的历史）
     */
    async prepareHistory(threadId: string): Promise<BaseMessage[]> {
        try {
            const allMessages = await this.getMessages(threadId);

            if (allMessages.length > this.maxHistoryMessages) {
                const recentMessages = this.truncateMessages(allMessages, this.maxHistoryMessages);

                await this.clearThread(threadId);

                logger.warn(`线程 ${threadId} 历史消息 ${allMessages.length} 条超限，截断为 ${recentMessages.length} 条`);
                return recentMessages;
            }

            return [];
        } catch (error: any) {
            logger.error(`线程 ${threadId} 准备历史记录失败: ${error.message}`);
            return [];
        }
    }

    /**
     * 智能截断消息历史，确保不会破坏 tool_calls 和 ToolMessage 的配对
     */
    truncateMessages(messages: BaseMessage[], maxCount: number): BaseMessage[] {
        if (messages.length <= maxCount) {
            return messages;
        }

        let startIndex = messages.length - maxCount;

        for (let i = startIndex; i >= 0 && i < messages.length; i++) {
            const msg = messages[i];

            if (msg instanceof ToolMessage) {
                continue;
            }

            if ((msg instanceof AIMessage || msg instanceof AIMessageChunk) && msg.tool_calls && msg.tool_calls.length > 0) {
                let toolMessageCount = 0;
                for (let j = i + 1; j < messages.length; j++) {
                    if (messages[j] instanceof ToolMessage) {
                        toolMessageCount++;
                    } else {
                        break;
                    }
                }

                if (i + toolMessageCount < messages.length) {
                    startIndex = i;
                    break;
                }
            } else {
                startIndex = i;
                break;
            }
        }

        return messages.slice(startIndex);
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
