import Database from "better-sqlite3";
import { existsSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { BaseMessage } from "langchain";
import { IAgentSaverService } from "./IAgentSaverService";
import { ILoggerService, ILogger } from "../Logger";
import { inject } from "scorpio.di";
import { T_DBPath, T_ThreadId } from "../Core/tokens";
import { MessageType, serializeMessage, deserializeMessage, applyTokenLimit } from "./messageSerializer";

// ─────────────────────────────────────────────────────────────────────────────
// AgentSqliteSaver
// 每个 thread 独立存储为 {dir}/{threadId}.db
// ─────────────────────────────────────────────────────────────────────────────

export class AgentSqliteSaver implements IAgentSaverService {
    private readonly db: Database.Database;
    private logger?: ILogger;

    readonly threadId: string;
    private readonly dir: string;

    constructor(
        @inject(T_ThreadId) threadId: string,
        @inject(T_DBPath) dir: string,
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService
    ) {
        this.threadId = threadId;
        this.dir = dir;
        this.logger = loggerService?.getLogger("AgentSqliteSaver");

        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        this.db = new Database(join(dir, `${threadId}.db`));
        this.db.pragma("journal_mode = WAL");
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS agent_messages (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                type       TEXT    NOT NULL,
                data       TEXT    NOT NULL,
                created_at INTEGER NOT NULL DEFAULT (unixepoch())
            );
        `);
    }

    async pushMessage(message: BaseMessage): Promise<void> {
        const { type, data } = serializeMessage(message);
        this.db.prepare("INSERT INTO agent_messages (type, data) VALUES (?, ?)").run(type, data);

        this.db.prepare(`
            DELETE FROM agent_messages
            WHERE id < (
                SELECT id FROM agent_messages
                ORDER BY id DESC
                LIMIT 1 OFFSET 999
            )
        `).run();
    }

    async getAllMessages(): Promise<BaseMessage[]> {
        try {
            const rows = this.db
                .prepare("SELECT type, data, created_at FROM agent_messages ORDER BY id")
                .all() as { type: string; data: string; created_at: number }[];
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

    async getMessages(maxTokens: number): Promise<BaseMessage[]> {
        return applyTokenLimit(await this.getAllMessages(), maxTokens);
    }

    async clearMessages(): Promise<void> {
        this.db.prepare("DELETE FROM agent_messages").run();
    }

    async getAllThreadIds(): Promise<string[]> {
        try {
            if (!existsSync(this.dir)) return [];
            return readdirSync(this.dir)
                .filter((f) => f.endsWith(".db"))
                .map((f) => f.slice(0, -3))
                .sort();
        } catch (error: any) {
            this.logger?.warn(`读取线程目录失败: ${error.message}`);
            return [];
        }
    }

    async dispose(): Promise<void> {
        try {
            this.db.close();
        } catch (error: any) {
            this.logger?.error(`AgentSqliteSaver 释放失败: ${error.message}`);
        }
    }
}
