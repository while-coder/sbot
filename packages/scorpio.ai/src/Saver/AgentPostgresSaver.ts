import { Pool } from "pg";
import { BaseMessage } from "langchain";
import { IAgentSaverService, SaverMessage } from "./IAgentSaverService";
import { ILoggerService, ILogger } from "../Logger";
import { inject } from "scorpio.di";
import { T_DBUrl, T_DBTable } from "../Core/tokens";
import { MessageType, serializeMessage, deserializeMessage, applyTokenLimit } from "./messageSerializer";

// ─────────────────────────────────────────────────────────────────────────────
// AgentPostgresSaver
// 每个 thread 独立一张表: {tableName}
// ─────────────────────────────────────────────────────────────────────────────

export class AgentPostgresSaver implements IAgentSaverService {
    private pool: Pool;
    private setupPromise?: Promise<void>;
    private logger?: ILogger;

    private readonly table: string;

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
        this.setupPromise ??= this.initTable();
        return this.setupPromise;
    }

    private async initTable(): Promise<void> {
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS ${this.table} (
                id         BIGSERIAL PRIMARY KEY,
                type       TEXT      NOT NULL,
                data       TEXT      NOT NULL,
                created_at BIGINT    NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
            )
        `);
    }

    async pushMessage(message: BaseMessage): Promise<void> {
        await this.ensureSetup();
        const { type, data } = serializeMessage(message);
        await this.pool.query(
            `INSERT INTO ${this.table} (type, data) VALUES ($1, $2)`,
            [type, data]
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

    async getAllMessages(): Promise<BaseMessage[]> {
        return (await this.getAllMessagesWithTime()).map((r) => r.message);
    }

    async getAllMessagesWithTime(): Promise<SaverMessage[]> {
        await this.ensureSetup();
        try {
            const result = await this.pool.query(
                `SELECT type, data, created_at FROM ${this.table} ORDER BY id`
            );
            return result.rows.map((r: { type: string; data: string; created_at: number }) => ({
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
        await this.ensureSetup();
        await this.pool.query(`DELETE FROM ${this.table}`);
    }

    async getThink(): Promise<SaverMessage[]> {
        return [];
    }

    async pushThinkMessages(): Promise<void> {}

    async dispose(): Promise<void> {
        try {
            await this.pool.end();
        } catch (error: any) {
            this.logger?.error(`AgentPostgresSaver 释放失败: ${error.message}`);
        }
    }
}
