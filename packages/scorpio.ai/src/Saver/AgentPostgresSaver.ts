import { Pool } from "pg";
import { IAgentSaverService, ChatMessage, StoredMessage, ChatMessageOptions } from "./IAgentSaverService";
import { ILoggerService, ILogger } from "../Logger";
import { inject } from "scorpio.di";
import { T_DBUrl, T_DBTable } from "../Core/tokens";

// ─────────────────────────────────────────────────────────────────────────────
// AgentPostgresSaver
// messages / thinks 两张表，表名前缀由 T_DBTable 注入
// ─────────────────────────────────────────────────────────────────────────────

export class AgentPostgresSaver implements IAgentSaverService {
    private pool: Pool;
    private setupPromise?: Promise<void>;
    private logger?: ILogger;

    private readonly table: string;
    private get thinksTable() { return `${this.table}_thinks`; }
    private get metadataTable() { return `${this.table}_metadata`; }

    constructor(
        @inject(T_DBTable) table: string,
        @inject(T_DBUrl) connectionString: string,
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService
    ) {
        this.table = table;
        this.logger = loggerService?.getLogger("AgentPostgresSaver");
        this.pool = new Pool({ connectionString });
    }

    private ensureSetup(): Promise<void> {
        this.setupPromise ??= this.initTables();
        return this.setupPromise;
    }

    private async initTables(): Promise<void> {
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS ${this.table} (
                id         BIGSERIAL PRIMARY KEY,
                data       TEXT      NOT NULL,
                created_at BIGINT    NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
                think_id   TEXT
            );
            CREATE TABLE IF NOT EXISTS ${this.thinksTable} (
                id              BIGSERIAL PRIMARY KEY,
                think_id        TEXT      NOT NULL,
                data            TEXT      NOT NULL,
                created_at      BIGINT    NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
                nested_think_id TEXT
            );
            CREATE TABLE IF NOT EXISTS ${this.metadataTable} (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_${this.table}_thinks_think_id
                ON ${this.thinksTable} (think_id);
        `);
        try {
            await this.pool.query(`ALTER TABLE ${this.table} ADD COLUMN compacted INTEGER NOT NULL DEFAULT 0`);
        } catch { /* column already exists */ }
        await this.pool.query(
            `CREATE INDEX IF NOT EXISTS idx_${this.table}_fts ON ${this.table} USING gin(to_tsvector('simple', data))`
        );
    }

    async pushMessage(message: ChatMessage, options?: ChatMessageOptions): Promise<void> {
        await this.ensureSetup();
        await this.pool.query(
            `INSERT INTO ${this.table} (data, created_at, think_id) VALUES ($1, $2, $3)`,
            [JSON.stringify(message), Math.floor(Date.now() / 1000), options?.thinkId ?? null]
        );
        await this.pool.query(`
            UPDATE ${this.table} SET compacted = 1
            WHERE compacted = 0 AND id < (
                SELECT id FROM ${this.table} WHERE compacted = 0
                ORDER BY id DESC
                LIMIT 1 OFFSET 999
            )
        `);
    }

    async getAllMessages(): Promise<StoredMessage[]> {
        await this.ensureSetup();
        try {
            const result = await this.pool.query(
                `SELECT id, data, created_at, think_id FROM ${this.table} WHERE compacted = 0 ORDER BY id`
            );
            return result.rows.map((r: any) => ({
                id: parseInt(r.id),
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
        await this.ensureSetup();
        await this.pool.query(`BEGIN`);
        try {
            const placeholders = compactedIds.map((_, i) => `$${i + 1}`).join(',');
            await this.pool.query(
                `UPDATE ${this.table} SET compacted = 1 WHERE id IN (${placeholders})`,
                compactedIds,
            );
            await this.pool.query(
                `INSERT INTO ${this.table} (data, created_at, think_id) VALUES ($1, $2, $3)`,
                [JSON.stringify(summary.message), summary.createdAt ?? Math.floor(Date.now() / 1000), summary.thinkId ?? null]
            );
            await this.pool.query(`COMMIT`);
        } catch (e) {
            await this.pool.query(`ROLLBACK`);
            throw e;
        }
    }

    async searchMessages(query: string, limit: number = 20): Promise<StoredMessage[]> {
        await this.ensureSetup();
        try {
            const result = await this.pool.query(
                `SELECT id, data, created_at, think_id FROM ${this.table}
                 WHERE to_tsvector('simple', data) @@ plainto_tsquery('simple', $1)
                 ORDER BY ts_rank(to_tsvector('simple', data), plainto_tsquery('simple', $1)) DESC
                 LIMIT $2`,
                [query, limit],
            );
            return result.rows.map((r: any) => ({
                id: parseInt(r.id),
                message: JSON.parse(r.data) as ChatMessage,
                createdAt: r.created_at,
                thinkId: r.think_id ?? undefined,
            }));
        } catch (error: any) {
            this.logger?.warn(`Postgres FTS 搜索失败: ${error.message}`);
            return [];
        }
    }

    async clearMessages(): Promise<void> {
        await this.ensureSetup();
        await this.pool.query(`DELETE FROM ${this.table}`);
    }

    async getThink(thinkId: string): Promise<StoredMessage[]> {
        await this.ensureSetup();
        try {
            const result = await this.pool.query(
                `SELECT data, created_at, nested_think_id FROM ${this.thinksTable} WHERE think_id = $1 ORDER BY id`,
                [thinkId]
            );
            return result.rows.map((r: { data: string; created_at: number; nested_think_id: string | null }) => ({
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
        await this.ensureSetup();
        await this.pool.query(
            `INSERT INTO ${this.thinksTable} (think_id, data, created_at, nested_think_id) VALUES ($1, $2, $3, $4)`,
            [thinkId, JSON.stringify(message), Math.floor(Date.now() / 1000), options?.thinkId ?? null]
        );
    }

    async getMetadata(key: string): Promise<string | undefined> {
        await this.ensureSetup();
        const result = await this.pool.query(
            `SELECT value FROM ${this.metadataTable} WHERE key = $1`, [key]
        );
        return result.rows[0]?.value;
    }

    async setMetadata(key: string, value: string): Promise<void> {
        await this.ensureSetup();
        await this.pool.query(
            `INSERT INTO ${this.metadataTable} (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`,
            [key, value]
        );
    }

    async dispose(): Promise<void> {
        try {
            await this.pool.end();
        } catch (error: any) {
            this.logger?.error(`AgentPostgresSaver 释放失败: ${error.message}`);
        }
    }
}
