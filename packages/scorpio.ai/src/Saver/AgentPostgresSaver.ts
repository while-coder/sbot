import { Pool } from "pg";
import { IAgentSaverService, ChatMessage, StoredMessage, ChatMessageOptions } from "./IAgentSaverService";
import { ILoggerService, ILogger } from "../Logger";
import { inject } from "scorpio.di";
import { T_DBUrl, T_DBTable } from "../Core/tokens";
import { applyTokenLimit } from "./messageSerializer";

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
            CREATE INDEX IF NOT EXISTS idx_${this.table}_thinks_think_id
                ON ${this.thinksTable} (think_id);
        `);
    }

    async pushMessage(message: ChatMessage, options?: ChatMessageOptions): Promise<void> {
        await this.ensureSetup();
        await this.pool.query(
            `INSERT INTO ${this.table} (data, created_at, think_id) VALUES ($1, $2, $3)`,
            [JSON.stringify(message), Math.floor(Date.now() / 1000), options?.thinkId ?? null]
        );
        await this.pool.query(`
            DELETE FROM ${this.table}
            WHERE id < (
                SELECT id FROM ${this.table}
                ORDER BY id DESC
                LIMIT 1 OFFSET 999
            )
        `);
    }

    async getAllMessages(): Promise<StoredMessage[]> {
        await this.ensureSetup();
        try {
            const result = await this.pool.query(
                `SELECT data, created_at, think_id FROM ${this.table} ORDER BY id`
            );
            return result.rows.map((r: { data: string; created_at: number; think_id: string | null }) => ({
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

    async dispose(): Promise<void> {
        try {
            await this.pool.end();
        } catch (error: any) {
            this.logger?.error(`AgentPostgresSaver 释放失败: ${error.message}`);
        }
    }
}
