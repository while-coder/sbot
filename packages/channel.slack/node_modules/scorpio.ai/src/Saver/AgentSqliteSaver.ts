import Database from "better-sqlite3";
import { BaseMessage } from "langchain";
import { IAgentSaverService } from "./IAgentSaverService";
import { ILoggerService, ILogger } from "../Logger";
import { inject } from "../DI";
import { T_DBPath, T_ThreadId } from "../Core/tokens";
import { MessageType, serializeMessage, deserializeMessage, applyTokenLimit } from "./messageSerializer";

// ─────────────────────────────────────────────────────────────────────────────
// AgentSqliteSaver
// ─────────────────────────────────────────────────────────────────────────────

export class AgentSqliteSaver implements IAgentSaverService {
    private db: Database.Database;
    private logger?: ILogger;

    readonly threadId: string;

    constructor(
        @inject(T_ThreadId) threadId: string,
        @inject(T_DBPath) dbPath: string,
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService
    ) {
        this.threadId = threadId;
        this.logger = loggerService?.getLogger("AgentSqliteSaver");
        this.db = new Database(dbPath);
        this.db.pragma("journal_mode = WAL");
        this.initTables();
    }

    private initTables(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS agent_messages (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                thread_id  TEXT    NOT NULL,
                type       TEXT    NOT NULL,
                data       TEXT    NOT NULL,
                created_at INTEGER NOT NULL DEFAULT (unixepoch())
            );
        `);
    }

    /**
     * 向当前线程追加一条消息
     */
    async pushMessage(message: BaseMessage): Promise<void> {
        const { type, data } = serializeMessage(message);
        this.db
            .prepare("INSERT INTO agent_messages (thread_id, type, data) VALUES (?, ?, ?)")
            .run(this.threadId, type, data);

        // 超过 1000 条时删除较早的记录
        this.db.prepare(`
            DELETE FROM agent_messages
            WHERE thread_id = ?
              AND id < (
                  SELECT id FROM agent_messages
                  WHERE thread_id = ?
                  ORDER BY id DESC
                  LIMIT 1 OFFSET 999
              )
        `).run(this.threadId, this.threadId);
    }

    /**
     * 获取当前线程的全部历史消息（不限制 token）
     */
    async getAllMessages(): Promise<BaseMessage[]> {
        try {
            const rows = this.db
                .prepare("SELECT type, data, created_at FROM agent_messages WHERE thread_id = ? ORDER BY id")
                .all(this.threadId) as { type: string; data: string; created_at: number }[];
            return rows.map((r) => {
                const msg = deserializeMessage(r.type as MessageType, r.data);
                if (r.created_at) {
                    msg.additional_kwargs = { ...msg.additional_kwargs, created_at: r.created_at };
                }
                return msg;
            });
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
        this.db
            .prepare("DELETE FROM agent_messages WHERE thread_id = ?")
            .run(this.threadId);
    }

    /**
     * 获取所有线程 ID 列表
     */
    async getAllThreadIds(): Promise<string[]> {
        try {
            const rows = this.db
                .prepare(
                    "SELECT DISTINCT thread_id FROM agent_messages ORDER BY thread_id"
                )
                .all() as { thread_id: string }[];
            return rows.map((r) => r.thread_id);
        } catch (error: any) {
            if (error.message?.includes("no such table")) return [];
            throw error;
        }
    }

    /**
     * 释放资源
     */
    async dispose(): Promise<void> {
        try {
            this.db.close();
        } catch (error: any) {
            this.logger?.error(`AgentSqliteSaver 释放失败: ${error.message}`);
        }
    }
}
