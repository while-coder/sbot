import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { IAgentSaverService, ChatMessage, StoredMessage, ChatMessageOptions } from "./IAgentSaverService";
import { ILoggerService, ILogger } from "../Logger";
import { inject } from "scorpio.di";
import { T_DBPath } from "../Core/tokens";

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
                CREATE TABLE IF NOT EXISTS metadata (
                    key   TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_thinks_think_id ON thinks (think_id);
            `);

            // Schema 迁移：添加 compacted 列
            try {
                this._db.exec(`ALTER TABLE messages ADD COLUMN compacted INTEGER NOT NULL DEFAULT 0`);
            } catch { /* 列已存在，忽略 */ }

            // FTS5 全文搜索索引
            this._db.exec(`
                CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
                    content,
                    content='messages',
                    content_rowid='id'
                );
                CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
                    INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.data);
                END;
                CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
                    INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.data);
                END;
                CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE ON messages BEGIN
                    INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.data);
                    INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.data);
                END;
            `);

            // 一次性迁移：为已有消息重建 FTS 索引
            const ftsInit = this._db.prepare("SELECT value FROM metadata WHERE key = 'fts5_initialized'").get() as { value: string } | undefined;
            if (!ftsInit) {
                this._db.exec(`INSERT INTO messages_fts(rowid, content) SELECT id, data FROM messages`);
                this._db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('fts5_initialized', '1')").run();
            }
        }
        return this._db;
    }

    async pushMessage(message: ChatMessage, options?: ChatMessageOptions): Promise<void> {
        this.db.prepare("INSERT INTO messages (data, created_at, think_id) VALUES (?, ?, ?)")
            .run(JSON.stringify(message), Math.floor(Date.now() / 1000), options?.thinkId ?? null);
    }

    async getAllMessages(): Promise<StoredMessage[]> {
        try {
            const rows = this.db
                .prepare("SELECT id, data, created_at, think_id FROM messages WHERE compacted = 0 ORDER BY id")
                .all() as { id: number; data: string; created_at: number; think_id: string | null }[];
            return rows.map((r) => ({
                id: r.id,
                message: JSON.parse(r.data) as ChatMessage,
                createdAt: r.created_at,
                thinkId: r.think_id ?? undefined,
            }));
        } catch (error: any) {
            this.logger?.warn(`获取历史消息失败: ${error.message}`);
            return [];
        }
    }

    async getMessages(): Promise<ChatMessage[]> {
        return (await this.getAllMessages()).map((r) => r.message);
    }

    async applyCompaction(compactedIds: number[], summary: StoredMessage): Promise<void> {
        if (compactedIds.length === 0) return;
        const txn = this.db.transaction(() => {
            const placeholders = compactedIds.map(() => '?').join(',');
            this.db.prepare(`UPDATE messages SET compacted = 1 WHERE id IN (${placeholders})`).run(...compactedIds);
            this.db.prepare("INSERT INTO messages (data, created_at, think_id) VALUES (?, ?, ?)")
                .run(JSON.stringify(summary.message), summary.createdAt ?? Math.floor(Date.now() / 1000), summary.thinkId ?? null);
        });
        txn();
    }

    async searchMessages(query: string, limit: number = 20): Promise<StoredMessage[]> {
        try {
            const rows = this.db.prepare(`
                SELECT m.id, m.data, m.created_at, m.think_id
                FROM messages_fts fts
                JOIN messages m ON m.id = fts.rowid
                WHERE messages_fts MATCH ?
                ORDER BY rank
                LIMIT ?
            `).all(query, limit) as { id: number; data: string; created_at: number; think_id: string | null }[];
            return rows.map((r) => ({
                id: r.id,
                message: JSON.parse(r.data) as ChatMessage,
                createdAt: r.created_at,
                thinkId: r.think_id ?? undefined,
            }));
        } catch (error: any) {
            this.logger?.warn(`FTS5 搜索失败: ${error.message}`);
            return [];
        }
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

    async getMetadata(key: string): Promise<string | undefined> {
        const row = this.db.prepare("SELECT value FROM metadata WHERE key = ?").get(key) as { value: string } | undefined;
        return row?.value;
    }

    async setMetadata(key: string, value: string): Promise<void> {
        this.db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)").run(key, value);
    }

    async dispose(): Promise<void> {
        try {
            this._db?.close();
        } catch (error: any) {
            this.logger?.error(`AgentSqliteSaver 释放失败: ${error.message}`);
        }
    }
}
