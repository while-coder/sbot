import { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { AIMessage, AIMessageChunk, BaseMessage, ToolMessage } from "langchain";
import { IAgentSaver } from "./IAgentSaver";
import { config } from "../Config";
import { LoggerService } from "../LoggerService";
import { inject, transient } from "../Core";

const logger = LoggerService.getLogger("AgentSqliteSaver.ts");

/**
 * 基于 SQLite 的 Agent Saver 实现
 * 使用 SQLite 数据库持久化对话历史
 */
@transient()
export class AgentSqliteSaver implements IAgentSaver {
    private saver: SqliteSaver | undefined;
    private userId: string;
    maxHistoryMessages: number = 10;

    constructor(@inject("UserId") userId: string) {
        this.userId = userId;
    }

    /**
     * 获取或创建 SqliteSaver 实例
     */
    private async createSaver(): Promise<SqliteSaver> {
        if (this.saver != null) return this.saver;

        // 使用 SQLite 数据库作为 checkpoint 存储
        const dbPath = config.getConfigPath(`saver/${this.userId}.sqlite`);

        // 初始化 SqliteSaver (无需手动调用 setup，会自动初始化)
        this.saver = SqliteSaver.fromConnString(dbPath);

        logger.debug(`用户 ${this.userId} 的 SqliteSaver 已创建: ${dbPath}`);

        return this.saver;
    }

    /**
     * 获取 LangGraph 的 CheckpointSaver 实例
     */
    async getCheckpointer(): Promise<BaseCheckpointSaver> {
        return await this.createSaver();
    }

    /**
     * 清除指定线程的所有历史记录
     */
    async clearThread(threadId: string): Promise<void> {
        const saver = await this.createSaver();
        await saver.deleteThread(threadId);
        logger.info(`用户 ${this.userId} 的线程 ${threadId} 历史记录已清除`);
    }

    /**
     * 获取指定线程的历史消息
     */
    async getMessages(threadId: string): Promise<BaseMessage[]> {
        try {
            const saver = await this.createSaver();

            // 获取当前状态
            const currentState = await saver.get({ configurable: { thread_id: threadId } });

            if (currentState?.channel_values) {
                const channelValues = currentState.channel_values as any;

                if (channelValues.messages && Array.isArray(channelValues.messages)) {
                    return channelValues.messages;
                }
            }

            return [];
        } catch (error: any) {
            logger.warn(`用户 ${this.userId} 获取线程 ${threadId} 历史消息失败: ${error.message}`);
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

                logger.info(`用户 ${this.userId} 历史消息数 ${allMessages.length} 超过限制 ${this.maxHistoryMessages}，开始清理多余的消息...`);

                return recentMessages;
            }

            return [];
        } catch (error: any) {
            logger.warn(`用户 ${this.userId} 检查历史记录时出错: ${error.message}`);
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
                // SqliteSaver 通常会有 end() 或类似方法来关闭数据库连接
                // @ts-ignore - SqliteSaver 可能有 db 属性用于访问底层数据库
                if (this.saver.db && typeof this.saver.db.close === 'function') {
                    await this.saver.db.close();
                    logger.debug(`用户 ${this.userId} 的 SqliteSaver 数据库连接已关闭`);
                }
            } catch (error: any) {
                logger.warn(`用户 ${this.userId} 释放 SqliteSaver 资源时出错: ${error.message}`);
            } finally {
                this.saver = undefined;
            }
        }
    }
}
