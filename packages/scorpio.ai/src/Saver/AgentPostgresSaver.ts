import { Pool } from "pg";
import { BaseMessage } from "langchain";
import { IAgentSaverService } from "./IAgentSaverService";
import { ILoggerService, ILogger } from "../Logger";
import { inject } from "scorpio.di";
import { T_DBUrl, T_ThreadId } from "../Core/tokens";
import { MessageType, serializeMessage, deserializeMessage, applyTokenLimit } from "./messageSerializer";

// ─────────────────────────────────────────────────────────────────────────────
// AgentPostgresSaver
// ─────────────────────────────────────────────────────────────────────────────

export class AgentPostgresSaver implements IAgentSaverService {
    private pool: Pool;
    private setupPromise?: Promise<void>;
    private logger?: ILogger;

    readonly threadId: string;

    constructor(
        @inject(T_ThreadId) threadId: string,
        @inject(T_DBUrl) connectionString: string,
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService
    ) {
        this.threadId = threadId;
        this.logger = loggerService?.getLogger("AgentPostgresSaver");
        this.pool = new Pool({ connectionString });
    }

    private ensureSetup(): Promise<void> {
        this.setupPromise ??= this.initTables();
        return this.setupPromise;
    }

    private async initTables(): Promise<void> {
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS agent_messages (
                id         BIGSERIAL PRIMARY KEY,
                thread_id  TEXT      NOT NULL,
                type       TEXT      NOT NULL,
                data       TEXT      NOT NULL,
                created_at BIGINT    NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
            )
        `);
    }

    /**
     * 向当前线程追加一条消息
     */
    async pushMessage(message: BaseMessage): Promise<void> {
        await this.ensureSetup();
        const { type, data } = serializeMessage(message);
        await this.pool.query(
            "INSERT INTO agent_messages (thread_id, type, data) VALUES ($1, $2, $3)",
            [this.threadId, type, data]
        );

        // 超过 1000 条时删除较早的记录
        await this.pool.query(`
            DELETE FROM agent_messages
            WHERE thread_id = $1
              AND id < (
                  SELECT id FROM agent_messages
                  WHERE thread_id = $1
                  ORDER BY id DESC
                  LIMIT 1 OFFSET 999
              )
        `, [this.threadId]);
    }

    /**
     * 获取当前线程的全部历史消息（不限制 token）
     */
    async getAllMessages(): Promise<BaseMessage[]> {
        await this.ensureSetup();
        try {
            const result = await this.pool.query(
                "SELECT type, data FROM agent_messages WHERE thread_id = $1 ORDER BY id",
                [this.threadId]
            );
            return result.rows.map((r: { type: string; data: string }) => deserializeMessage(r.type as MessageType, r.data));
        } catch (error: any) {
            this.logger?.warn(`获取线程 ${this.threadId} 历史消息失败: ${error.message}`);
            return [];
        }
    }

    /**
     * 获取当前线程的历史消息，从末尾截取不超过 maxTokens 的部分
     * 确保不破坏 tool_calls 和 ToolMessage 的配对
     */
    async getMessages(maxTokens: number): Promise<BaseMessage[]> {
        return applyTokenLimit(await this.getAllMessages(), maxTokens);
    }

    /**
     * 清除当前线程的所有历史记录
     */
    async clearMessages(): Promise<void> {
        await this.ensureSetup();
        await this.pool.query(
            "DELETE FROM agent_messages WHERE thread_id = $1",
            [this.threadId]
        );
    }

    /**
     * 获取所有线程 ID 列表
     */
    async getAllThreadIds(): Promise<string[]> {
        await this.ensureSetup();
        try {
            const result = await this.pool.query(
                "SELECT DISTINCT thread_id FROM agent_messages ORDER BY thread_id"
            );
            return result.rows.map((r: { thread_id: string }) => r.thread_id);
        } catch (error: any) {
            if (error.code === "42P01" || error.message?.includes("does not exist")) return [];
            throw error;
        }
    }

    /**
     * 释放资源，关闭连接池
     */
    async dispose(): Promise<void> {
        try {
            await this.pool.end();
        } catch (error: any) {
            this.logger?.error(`AgentPostgresSaver 释放失败: ${error.message}`);
        }
    }
}
