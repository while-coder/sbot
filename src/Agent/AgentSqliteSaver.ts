import { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { BaseMessage } from "langchain";
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
