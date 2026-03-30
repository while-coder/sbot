import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { BaseMessage } from "langchain";
import { IAgentSaverService, SaverMessage } from "./IAgentSaverService";
import { ILoggerService, ILogger } from "../Logger";
import { inject } from "scorpio.di";
import { T_DBPath } from "../Core/tokens";
import { MessageType, serializeMessage, deserializeMessage, applyTokenLimit } from "./messageSerializer";

// ─────────────────────────────────────────────────────────────────────────────
// AgentSqliteSaver
// 直接读写指定的 SQLite 文件，懒初始化
// ─────────────────────────────────────────────────────────────────────────────

export class AgentSqliteSaver implements IAgentSaverService {
    private _db: Database.Database | undefined;
    private readonly dbPath: string;
    private logger?: ILogger;

    constructor(
        @inject(T_DBPath) dbPath: string,
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService
    ) {
        this.dbPath = dbPath;
        this.logger = loggerService?.getLogger("AgentSqliteSaver");
    }

    private get db(): Database.Database {
        if (!this._db) {
            const dir = dirname(this.dbPath);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            this._db = new Database(this.dbPath);
            this._db.pragma("journal_mode = WAL");
            this._db.exec(`
                CREATE TABLE IF NOT EXISTS agent_messages (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    type       TEXT    NOT NULL,
                    data       TEXT    NOT NULL,
                    created_at INTEGER NOT NULL DEFAULT (unixepoch())
                );
            `);
        }
        return this._db;
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
        return (await this.getAllMessagesWithTime()).map((r) => r.message);
    }

    async getAllMessagesWithTime(): Promise<SaverMessage[]> {
        try {
            const rows = this.db
                .prepare("SELECT type, data, created_at FROM agent_messages ORDER BY id")
                .all() as { type: string; data: string; created_at: number }[];
            return rows.map((r) => ({
                message: deserializeMessage(r.type as MessageType, r.data),
                createdAt: r.created_at,
            }));
        } catch (error: any) {
            this.logger?.warn(`获取历史消息失败: ${error.message}`);
            return [];
        }
    }

    async getMessages(maxTokens: number): Promise<BaseMessage[]> {
        return applyTokenLimit(await this.getAllMessages(), maxTokens);
    }

    async clearMessages(): Promise<void> {
        this.db.prepare("DELETE FROM agent_messages").run();
    }

    async dispose(): Promise<void> {
        try {
            this._db?.close();
        } catch (error: any) {
            this.logger?.error(`AgentSqliteSaver 释放失败: ${error.message}`);
        }
    }
}
