import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { IAgentSaverService, ChatMessage, StoredMessage, ChatMessageOptions } from "./IAgentSaverService";
import { ILoggerService, ILogger } from "../Logger";
import { inject } from "scorpio.di";
import { T_DBPath } from "../Core/tokens";
import { applyTokenLimit } from "./messageSerializer";

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
                CREATE TABLE IF NOT EXISTS messages (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    data       TEXT    NOT NULL,
                    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
                    think_id   TEXT
                );
                CREATE TABLE IF NOT EXISTS thinks (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    think_id        TEXT    NOT NULL,
                    data            TEXT    NOT NULL,
                    created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
                    nested_think_id TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_thinks_think_id ON thinks (think_id);
            `);
        }
        return this._db;
    }

    async pushMessage(message: ChatMessage, options?: ChatMessageOptions): Promise<void> {
        this.db.prepare("INSERT INTO messages (data, created_at, think_id) VALUES (?, ?, ?)")
            .run(JSON.stringify(message), Math.floor(Date.now() / 1000), options?.thinkId ?? null);

        this.db.prepare(`
            DELETE FROM messages
            WHERE id < (
                SELECT id FROM messages
                ORDER BY id DESC
                LIMIT 1 OFFSET 999
            )
        `).run();
    }

    async getAllMessages(): Promise<StoredMessage[]> {
        try {
            const rows = this.db
                .prepare("SELECT data, created_at, think_id FROM messages ORDER BY id")
                .all() as { data: string; created_at: number; think_id: string | null }[];
            return rows.map((r) => ({
                message: JSON.parse(r.data) as ChatMessage,
                createdAt: r.created_at,
                thinkId: r.think_id ?? undefined,
            }));
        } catch (error: any) {
            this.logger?.warn(`获取历史消息失败: ${error.message}`);
            return [];
        }
    }

    async getMessages(maxTokens: number): Promise<ChatMessage[]> {
        return applyTokenLimit((await this.getAllMessages()).map((r) => r.message), maxTokens);
    }

    async clearMessages(): Promise<void> {
        this.db.prepare("DELETE FROM messages").run();
    }

    async getThink(thinkId: string): Promise<StoredMessage[]> {
        try {
            const rows = this.db
                .prepare("SELECT data, created_at, nested_think_id FROM thinks WHERE think_id = ? ORDER BY id")
                .all(thinkId) as { data: string; created_at: number; nested_think_id: string | null }[];
            return rows.map((r) => ({
                message: JSON.parse(r.data) as ChatMessage,
                createdAt: r.created_at,
                thinkId: r.nested_think_id ?? undefined,
            }));
        } catch (error: any) {
            this.logger?.warn(`获取 think 消息失败: ${error.message}`);
            return [];
        }
    }

    async pushThinkMessage(thinkId: string, message: ChatMessage, options?: ChatMessageOptions): Promise<void> {
        this.db.prepare("INSERT INTO thinks (think_id, data, created_at, nested_think_id) VALUES (?, ?, ?, ?)")
            .run(thinkId, JSON.stringify(message), Math.floor(Date.now() / 1000), options?.thinkId ?? null);
    }

    async dispose(): Promise<void> {
        try {
            this._db?.close();
        } catch (error: any) {
            this.logger?.error(`AgentSqliteSaver 释放失败: ${error.message}`);
        }
    }
}
