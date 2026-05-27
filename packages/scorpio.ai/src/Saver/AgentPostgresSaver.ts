import { Pool } from "pg";
import {
    IAgentSaverService,
    ChatMessage,
    StoredMessage,
    NewStoredMessage,
    ChatMessageOptions,
    MessageKind,
} from "./IAgentSaverService";
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
    private get tasksTable() { return `${this.table}_tasks`; }
    private get taskMetadataTable() { return `${this.table}_task_metadata`; }

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
            CREATE TABLE IF NOT EXISTS ${this.tasksTable} (
                id         BIGSERIAL PRIMARY KEY,
                task_id    TEXT      NOT NULL,
                data       TEXT      NOT NULL,
                created_at BIGINT    NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
                think_id   TEXT,
                kind       TEXT
            );
            CREATE TABLE IF NOT EXISTS ${this.taskMetadataTable} (
                task_id TEXT NOT NULL,
                key     TEXT NOT NULL,
                value   TEXT NOT NULL,
                PRIMARY KEY (task_id, key)
            );
            CREATE INDEX IF NOT EXISTS idx_${this.table}_thinks_think_id
                ON ${this.thinksTable} (think_id);
            CREATE INDEX IF NOT EXISTS idx_${this.table}_tasks_task_id
                ON ${this.tasksTable} (task_id);
        `);
        try {
            await this.pool.query(`ALTER TABLE ${this.table} ADD COLUMN kind TEXT`);
        } catch { /* column already exists */ }
        await this.pool.query(
            `CREATE INDEX IF NOT EXISTS idx_${this.table}_fts ON ${this.table} USING gin(to_tsvector('simple', data))`
        );
    }

    async pushMessage(message: ChatMessage, options?: ChatMessageOptions): Promise<void> {
        await this.ensureSetup();
        await this.pool.query(
            `INSERT INTO ${this.table} (data, created_at, think_id, kind) VALUES ($1, $2, $3, $4)`,
            [
                JSON.stringify(message),
                Math.floor(Date.now() / 1000),
                options?.thinkId ?? null,
                options?.kind ?? MessageKind.Normal,
            ]
        );
    }

    async getAllMessages(includeAll = false): Promise<StoredMessage[]> {
        await this.ensureSetup();
        try {
            const filter = includeAll
                ? ""
                : ` WHERE kind IS NULL OR kind = 'normal'`;
            const sql = `SELECT id, data, created_at, think_id, kind FROM ${this.table}${filter} ORDER BY id`;
            const result = await this.pool.query(sql);
            return result.rows.map((r: any) => ({
                id: parseInt(r.id),
                message: JSON.parse(r.data) as ChatMessage,
                createdAt: r.created_at,
                thinkId: r.think_id ?? undefined,
                kind: (r.kind as MessageKind | null) ?? MessageKind.Normal,
            }));
        } catch (error: any) {
            this.logger?.warn(`获取历史消息失败: ${error.message}`);
            return [];
        }
    }

    async getMessages(): Promise<ChatMessage[]> {
        return (await this.getAllMessages()).map((r) => r.message);
    }

    async applyCompaction(compactedIds: number[], summary: NewStoredMessage): Promise<void> {
        if (compactedIds.length === 0) return;
        await this.ensureSetup();
        await this.pool.query(`BEGIN`);
        try {
            const placeholders = compactedIds.map((_, i) => `$${i + 1}`).join(',');
            await this.pool.query(
                `UPDATE ${this.table} SET kind = 'archive' WHERE id IN (${placeholders})`,
                compactedIds,
            );
            await this.pool.query(
                `INSERT INTO ${this.table} (data, created_at, think_id, kind) VALUES ($1, $2, $3, $4)`,
                [
                    JSON.stringify(summary.message),
                    Math.floor(Date.now() / 1000),
                    summary.thinkId ?? null,
                    summary.kind,
                ]
            );
            await this.pool.query(`COMMIT`);
        } catch (e) {
            await this.pool.query(`ROLLBACK`);
            throw e;
        }
    }

    async searchArchive(query: string[][], limit: number = 20): Promise<StoredMessage[]> {
        if (query.length === 0 || query.some(g => g.length === 0)) return [];
        await this.ensureSetup();
        const params: any[] = [];
        const groupExprs = query.map(group => {
            const orExprs = group.map(term => {
                params.push(term);
                return `plainto_tsquery('simple', $${params.length})`;
            });
            return `(${orExprs.join(' || ')})`;
        });
        const tsq = groupExprs.join(' && ');
        params.push(limit);
        try {
            const result = await this.pool.query(
                `WITH q AS (SELECT (${tsq}) AS query)
                 SELECT m.id, m.data, m.created_at, m.think_id
                 FROM ${this.table} m, q
                 WHERE to_tsvector('simple', m.data) @@ q.query AND m.kind = 'archive'
                 ORDER BY ts_rank(to_tsvector('simple', m.data), q.query) DESC
                 LIMIT $${params.length}`,
                params,
            );
            return result.rows.map((r: any) => ({
                id: parseInt(r.id),
                message: JSON.parse(r.data) as ChatMessage,
                createdAt: r.created_at,
                thinkId: r.think_id ?? undefined,
                kind: MessageKind.Archive,
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
                `SELECT id, data, created_at, nested_think_id FROM ${this.thinksTable} WHERE think_id = $1 ORDER BY id`,
                [thinkId]
            );
            return result.rows.map((r: { id: string; data: string; created_at: number; nested_think_id: string | null }) => ({
                id: parseInt(r.id),
                message: JSON.parse(r.data) as ChatMessage,
                createdAt: r.created_at,
                thinkId: r.nested_think_id ?? undefined,
                kind: MessageKind.Normal,
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

    // --- Task scope ---

    async getTaskMessages(taskId: string, includeAll = false): Promise<StoredMessage[]> {
        await this.ensureSetup();
        try {
            const filter = includeAll
                ? ""
                : ` AND (kind IS NULL OR kind = 'normal')`;
            const sql = `SELECT id, data, created_at, think_id, kind FROM ${this.tasksTable} WHERE task_id = $1${filter} ORDER BY id`;
            const result = await this.pool.query(sql, [taskId]);
            return result.rows.map((r: any) => ({
                id: parseInt(r.id),
                message: JSON.parse(r.data) as ChatMessage,
                createdAt: r.created_at,
                thinkId: r.think_id ?? undefined,
                kind: (r.kind as MessageKind | null) ?? MessageKind.Normal,
            }));
        } catch (error: any) {
            this.logger?.warn(`获取 task 历史失败: ${error.message}`);
            return [];
        }
    }

    async pushTaskMessage(taskId: string, message: ChatMessage, options?: ChatMessageOptions): Promise<void> {
        await this.ensureSetup();
        await this.pool.query(
            `INSERT INTO ${this.tasksTable} (task_id, data, created_at, think_id, kind) VALUES ($1, $2, $3, $4, $5)`,
            [
                taskId,
                JSON.stringify(message),
                Math.floor(Date.now() / 1000),
                options?.thinkId ?? null,
                options?.kind ?? MessageKind.Normal,
            ]
        );
    }

    async applyTaskCompaction(taskId: string, compactedIds: number[], summary: NewStoredMessage): Promise<void> {
        if (compactedIds.length === 0) return;
        await this.ensureSetup();
        await this.pool.query(`BEGIN`);
        try {
            const placeholders = compactedIds.map((_, i) => `$${i + 2}`).join(',');
            await this.pool.query(
                `UPDATE ${this.tasksTable} SET kind = 'archive' WHERE task_id = $1 AND id IN (${placeholders})`,
                [taskId, ...compactedIds],
            );
            await this.pool.query(
                `INSERT INTO ${this.tasksTable} (task_id, data, created_at, think_id, kind) VALUES ($1, $2, $3, $4, $5)`,
                [
                    taskId,
                    JSON.stringify(summary.message),
                    Math.floor(Date.now() / 1000),
                    summary.thinkId ?? null,
                    summary.kind,
                ]
            );
            await this.pool.query(`COMMIT`);
        } catch (e) {
            await this.pool.query(`ROLLBACK`);
            throw e;
        }
    }

    async clearTask(taskId: string): Promise<void> {
        await this.ensureSetup();
        await this.pool.query(`BEGIN`);
        try {
            await this.pool.query(`DELETE FROM ${this.tasksTable} WHERE task_id = $1`, [taskId]);
            await this.pool.query(`DELETE FROM ${this.taskMetadataTable} WHERE task_id = $1`, [taskId]);
            await this.pool.query(`COMMIT`);
        } catch (e) {
            await this.pool.query(`ROLLBACK`);
            throw e;
        }
    }

    async getTaskMetadata(taskId: string, key: string): Promise<string | undefined> {
        await this.ensureSetup();
        const result = await this.pool.query(
            `SELECT value FROM ${this.taskMetadataTable} WHERE task_id = $1 AND key = $2`,
            [taskId, key]
        );
        return result.rows[0]?.value;
    }

    async setTaskMetadata(taskId: string, key: string, value: string): Promise<void> {
        await this.ensureSetup();
        await this.pool.query(
            `INSERT INTO ${this.taskMetadataTable} (task_id, key, value) VALUES ($1, $2, $3) ON CONFLICT (task_id, key) DO UPDATE SET value = $3`,
            [taskId, key, value]
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
