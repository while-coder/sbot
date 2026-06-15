import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { rm } from "fs/promises";
import path from "path";
import { inject } from "scorpio.di";
import { T_AgendaDbPath } from "../../Core";
import type { ChatMessage } from "../../Saver";
import {
    AgendaPendingJobType,
    type AgendaPendingJobStatus,
    type PendingAgendaJobRow,
    IAgendaStore,
} from "./IAgendaStore";
import type {
    AgendaItem,
    AgendaOccurrence,
    AgendaRecord,
    AgendaTrigger,
} from "../types";

// triggerId / occurrenceId 编码：itemId * CHILD_ID_FACTOR + 自增 sub。
// 沿用这个编码是为了 inferItemIdFromChildId 不查 DB 也能拿到 itemId。
const CHILD_ID_FACTOR = 1_000;

type AgendaTable = "items" | "triggers" | "occurrences";

/**
 * 单 agenda 模板的存储。绑定一个 db 文件路径，构造后不再变化。
 * 通过 `get db()` 懒初始化 SQLite 连接，进程生命周期内复用同一连接，
 * 调用 `dispose()` 显式关闭。
 */
export class AgendaStore implements IAgendaStore {
    private _db: Database.Database | undefined;
    private lock = Promise.resolve();

    constructor(
        @inject(T_AgendaDbPath) private readonly dbPath: string,
    ) {}

    /** 显式触发 schema 创建。幂等。pool build 之后调用一次，确保表存在。 */
    init(): void {
        // 触发 lazy db 初始化，schema 在 get db() 里建好
        void this.db;
    }

    private get db(): Database.Database {
        if (!this._db) {
            const dir = path.dirname(this.dbPath);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            this._db = new Database(this.dbPath);
            this._db.pragma("journal_mode = WAL");
            this._db.exec(`
                CREATE TABLE IF NOT EXISTS items (
                    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                    content             TEXT    NOT NULL,
                    status              TEXT    NOT NULL,
                    priority            TEXT    NOT NULL,
                    category            TEXT    NOT NULL,
                    completionMode      TEXT    NOT NULL,
                    dueAt               INTEGER,
                    source              TEXT    NOT NULL,
                    createdAt           INTEGER NOT NULL,
                    updatedAt           INTEGER NOT NULL,
                    doneAt              INTEGER
                );
                CREATE TABLE IF NOT EXISTS triggers (
                    id             INTEGER PRIMARY KEY,
                    itemId         INTEGER NOT NULL,
                    kind           TEXT    NOT NULL,
                    expr           TEXT    NOT NULL,
                    action         TEXT    NOT NULL,
                    message        TEXT,
                    channelHint    INTEGER NOT NULL,
                    enabled        INTEGER NOT NULL,
                    fireCount      INTEGER NOT NULL,
                    maxFires       INTEGER NOT NULL,
                    lastFiredAt    INTEGER,
                    nextFireAt     INTEGER,
                    createdAt      INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS occurrences (
                    id          INTEGER PRIMARY KEY,
                    itemId      INTEGER NOT NULL,
                    scheduledAt INTEGER NOT NULL,
                    status      TEXT    NOT NULL,
                    doneAt      INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_items_status ON items (status, dueAt);
                CREATE INDEX IF NOT EXISTS idx_triggers_item ON triggers (itemId, id);
                CREATE INDEX IF NOT EXISTS idx_triggers_enabled ON triggers (enabled, nextFireAt);
                CREATE INDEX IF NOT EXISTS idx_occurrences_item_status ON occurrences (itemId, status, scheduledAt);

                -- 待处理抽取 job 队列：每轮对话末尾入队，AgendaService 通过 isRunning 标志串行消费；
                -- 失败行保留 status='failed'，不再自动重试，由 admin 决定。
                CREATE TABLE IF NOT EXISTS agenda_pending_jobs (
                    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_type            TEXT    NOT NULL DEFAULT 'extract',
                    channel_session_id  INTEGER NOT NULL,
                    payload_json        TEXT    NOT NULL DEFAULT '{}',
                    status              TEXT    NOT NULL DEFAULT 'pending',
                    attempt_count       INTEGER NOT NULL DEFAULT 0,
                    error_message       TEXT,
                    created_at          INTEGER NOT NULL,
                    updated_at          INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_agenda_pending_status_id ON agenda_pending_jobs (status, id);
            `);
        }
        return this._db;
    }

    private inferItemIdFromChildId(childId: number): number {
        return Math.floor(childId / CHILD_ID_FACTOR);
    }

    private async withLock<T>(fn: () => Promise<T>): Promise<T> {
        const previous = this.lock;
        let release!: () => void;
        this.lock = new Promise<void>(resolve => { release = resolve; });
        await previous;
        try {
            return await fn();
        } finally {
            release();
        }
    }

    private readAgendaRecordFromDb(itemId: number): AgendaRecord | null {
        const item = this.db.prepare("SELECT * FROM items WHERE id = ?").get(itemId) as AgendaItem | undefined;
        if (!item) return null;
        return this.buildAgendaRecord(item);
    }

    private buildAgendaRecord(item: AgendaItem): AgendaRecord {
        const triggers = (this.db.prepare("SELECT * FROM triggers WHERE itemId = ? ORDER BY id").all(item.id) as any[]).map(row => ({
            ...row,
            enabled: Boolean(row.enabled),
        })) as AgendaTrigger[];
        const occurrences = this.db.prepare("SELECT * FROM occurrences WHERE itemId = ? ORDER BY scheduledAt, id").all(item.id) as AgendaOccurrence[];
        return { item, triggers, occurrences };
    }

    private insertItem(item: Omit<AgendaItem, "id">): number {
        const result = this.db.prepare(`
            INSERT INTO items (
                content, status, priority, category, completionMode,
                dueAt, source, createdAt, updatedAt, doneAt
            ) VALUES (
                @content, @status, @priority, @category, @completionMode,
                @dueAt, @source, @createdAt, @updatedAt, @doneAt
            )
        `).run(item);
        return Number(result.lastInsertRowid);
    }

    async listItems(): Promise<AgendaRecord[]> {
        if (!existsSync(this.dbPath)) return [];
        const items = this.db.prepare("SELECT * FROM items ORDER BY id").all() as AgendaItem[];
        return items.map(item => this.buildAgendaRecord(item));
    }

    async findItem(itemId: number): Promise<AgendaRecord | null> {
        if (!existsSync(this.dbPath)) return null;
        return this.readAgendaRecordFromDb(itemId);
    }

    async findTrigger(triggerId: number): Promise<{ data: AgendaRecord; trigger: AgendaTrigger } | null> {
        const data = await this.findItem(this.inferItemIdFromChildId(triggerId));
        const trigger = data?.triggers.find(t => t.id === triggerId);
        return data && trigger ? { data, trigger } : null;
    }

    async listEnabledTriggers(): Promise<AgendaTrigger[]> {
        const triggers: AgendaTrigger[] = [];
        for (const record of await this.listItems()) {
            triggers.push(...record.triggers.filter(t => t.enabled));
        }
        return triggers.sort((a, b) => a.id - b.id);
    }

    async createItem(item: Omit<AgendaItem, "id">): Promise<AgendaRecord> {
        return this.withLock(async () => {
            const id = this.insertItem(item);
            return { item: { id, ...item }, triggers: [], occurrences: [] };
        });
    }

    async updateItem(itemId: number, fields: Partial<AgendaItem>): Promise<AgendaRecord | null> {
        return this.withLock(async () => {
            if (!existsSync(this.dbPath)) return null;
            this.updateById("items", itemId, fields);
            return this.readAgendaRecordFromDb(itemId);
        });
    }

    async updateTrigger(triggerId: number, fields: Partial<AgendaTrigger>): Promise<AgendaRecord | null> {
        return this.withLock(async () => {
            if (!existsSync(this.dbPath)) return null;
            const itemId = this.inferItemIdFromChildId(triggerId);
            if (!this.updateById("triggers", triggerId, fields, new Set(["enabled"]))) return null;
            return this.readAgendaRecordFromDb(itemId);
        });
    }

    async updateActiveTriggersByItem(itemId: number, fields: Partial<AgendaTrigger>, exceptTriggerId?: number): Promise<number[]> {
        return this.withLock(async () => {
            if (!existsSync(this.dbPath)) return [];
            const rows = this.db.prepare("SELECT id FROM triggers WHERE itemId = ? AND enabled = 1 ORDER BY id").all(itemId) as Array<{ id: number }>;
            const ids: number[] = [];
            for (const row of rows) {
                if (row.id === exceptTriggerId) continue;
                ids.push(row.id);
                this.updateById("triggers", row.id, fields, new Set(["enabled"]));
            }
            return ids;
        });
    }

    async appendTrigger(itemId: number, trigger: Omit<AgendaTrigger, "id">): Promise<AgendaTrigger | null> {
        return this.withLock(async () => {
            if (!this.hasItem(itemId)) return null;
            const row = { ...trigger, id: this.nextChildIdInDb("triggers", itemId) };
            this.db.prepare(`
                INSERT INTO triggers (
                    id, itemId, kind, expr, action, message, channelHint, enabled,
                    fireCount, maxFires, lastFiredAt, nextFireAt, createdAt
                ) VALUES (
                    @id, @itemId, @kind, @expr, @action, @message, @channelHint, @enabled,
                    @fireCount, @maxFires, @lastFiredAt, @nextFireAt, @createdAt
                )
            `).run({ ...row, enabled: row.enabled ? 1 : 0 });
            return row;
        });
    }

    async appendOccurrence(itemId: number, occurrence: Omit<AgendaOccurrence, "id">): Promise<AgendaOccurrence | null> {
        return this.withLock(async () => {
            if (!this.hasItem(itemId)) return null;
            const row = { ...occurrence, id: this.nextChildIdInDb("occurrences", itemId) };
            this.db.prepare(`
                INSERT INTO occurrences (id, itemId, scheduledAt, status, doneAt)
                VALUES (@id, @itemId, @scheduledAt, @status, @doneAt)
            `).run(row);
            return row;
        });
    }

    async updateOccurrence(occurrenceId: number, fields: Partial<AgendaOccurrence>): Promise<AgendaRecord | null> {
        return this.withLock(async () => {
            if (!existsSync(this.dbPath)) return null;
            const itemId = this.inferItemIdFromChildId(occurrenceId);
            const changed = this.updateById("occurrences", occurrenceId, fields);
            return changed ? this.readAgendaRecordFromDb(itemId) : null;
        });
    }

    async markPendingOccurrencesMissed(itemId: number, missedAt: number): Promise<number[]> {
        return this.withLock(async () => {
            if (!existsSync(this.dbPath)) return [];
            const rows = this.db.prepare(
                "SELECT id FROM occurrences WHERE itemId = ? AND status = 'pending'"
            ).all(itemId) as Array<{ id: number }>;
            if (rows.length === 0) return [];
            const update = this.db.prepare(
                "UPDATE occurrences SET status = 'missed', doneAt = ? WHERE id = ?"
            );
            this.db.transaction(() => {
                for (const row of rows) update.run(missedAt, row.id);
            })();
            return rows.map(r => r.id);
        });
    }

    async deleteItem(itemId: number): Promise<AgendaRecord | null> {
        return this.withLock(async () => {
            if (!existsSync(this.dbPath)) return null;
            const data = this.readAgendaRecordFromDb(itemId);
            if (!data) return null;
            this.db.transaction(() => {
                this.db.prepare("DELETE FROM occurrences WHERE itemId = ?").run(itemId);
                this.db.prepare("DELETE FROM triggers WHERE itemId = ?").run(itemId);
                this.db.prepare("DELETE FROM items WHERE id = ?").run(itemId);
            })();
            return data;
        });
    }

    async deleteAll(): Promise<number[]> {
        return this.withLock(async () => {
            const records = await this.listItems();
            const triggerIds = records.flatMap(record => record.triggers.map(t => t.id));
            this.dispose();
            await rm(path.dirname(this.dbPath), { recursive: true, force: true });
            return triggerIds;
        });
    }

    dispose(): void {
        this._db?.close();
        this._db = undefined;
    }

    // ── 待处理 job 队列 ──

    pushPendingMessages(channelSessionId: number, messages: ChatMessage[], now: number): number {
        const result = this.db.prepare(`
            INSERT INTO agenda_pending_jobs (
                job_type, channel_session_id, payload_json, status, attempt_count, created_at, updated_at
            ) VALUES (
                @jobType, @channelSessionId, @payloadJson, 'pending', 0, @now, @now
            )
        `).run({
            jobType: AgendaPendingJobType.Extract,
            channelSessionId,
            payloadJson: JSON.stringify({ messages }),
            now,
        });
        return Number(result.lastInsertRowid);
    }

    popPendingJob(): PendingAgendaJobRow | null {
        const row = this.db.prepare(`
            SELECT id, job_type, channel_session_id, payload_json, status, attempt_count, error_message, created_at, updated_at
            FROM agenda_pending_jobs
            WHERE status = 'pending'
            ORDER BY id ASC
            LIMIT 1
        `).get() as any;
        if (!row) return null;
        return this.mapPendingRow(row);
    }

    deletePendingJob(id: number): void {
        this.db.prepare(`DELETE FROM agenda_pending_jobs WHERE id = ?`).run(id);
    }

    markPendingJobFailed(id: number, errorMessage: string, now: number): void {
        this.db.prepare(`
            UPDATE agenda_pending_jobs
            SET status        = 'failed',
                error_message = @errorMessage,
                attempt_count = attempt_count + 1,
                updated_at    = @now
            WHERE id = @id
        `).run({ id, errorMessage: errorMessage.slice(0, 1000), now });
    }

    listPendingJobs(limit: number): PendingAgendaJobRow[] {
        const rows = this.db.prepare(`
            SELECT id, job_type, channel_session_id, payload_json, status, attempt_count, error_message, created_at, updated_at
            FROM agenda_pending_jobs
            ORDER BY id DESC
            LIMIT @limit
        `).all({ limit: Math.max(1, Math.min(limit, 200)) }) as any[];
        return rows.map(r => this.mapPendingRow(r));
    }

    private nextChildIdInDb(table: "triggers" | "occurrences", itemId: number): number {
        const base = itemId * CHILD_ID_FACTOR;
        const row = this.db.prepare(`SELECT MAX(id) AS id FROM ${table} WHERE itemId = ?`).get(itemId) as { id: number | null };
        return Math.max(base, row.id ?? 0) + 1;
    }

    private updateById(table: AgendaTable, id: number, fields: Record<string, any>, booleanFields = new Set<string>()): boolean {
        const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
        if (entries.length === 0) return false;
        const values = Object.fromEntries(entries.map(([key, value]) => [key, booleanFields.has(key) ? (value ? 1 : 0) : value]));
        const setSql = entries.map(([key]) => `${key} = @${key}`).join(", ");
        const result = this.db.prepare(`UPDATE ${table} SET ${setSql} WHERE id = @id`).run({ ...values, id });
        return result.changes > 0;
    }

    private hasItem(itemId: number): boolean {
        return Boolean(this.db.prepare("SELECT 1 FROM items WHERE id = ?").get(itemId));
    }

    private mapPendingRow(r: any): PendingAgendaJobRow {
        const type = this.normalizePendingJobType(r.job_type);
        const payload = this.parsePendingPayload(r.payload_json);
        return {
            id: r.id,
            type,
            channelSessionId: Number(r.channel_session_id) || 0,
            messages: type === AgendaPendingJobType.Extract ? (payload.messages ?? []) : undefined,
            status: this.normalizePendingStatus(r.status),
            attemptCount: r.attempt_count ?? 0,
            errorMessage: r.error_message ?? null,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
        };
    }

    private parsePendingPayload(json: string | null | undefined): { messages?: ChatMessage[] } {
        try {
            const parsed = JSON.parse(json ?? '{}');
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
            const messages = Array.isArray((parsed as any).messages) ? ((parsed as any).messages as ChatMessage[]) : undefined;
            return messages ? { messages } : {};
        } catch {
            return {};
        }
    }

    private normalizePendingJobType(type: string | undefined | null): AgendaPendingJobType {
        return type === AgendaPendingJobType.Extract ? AgendaPendingJobType.Extract : AgendaPendingJobType.Extract;
    }

    private normalizePendingStatus(status: string | undefined | null): AgendaPendingJobStatus {
        return status === 'failed' ? 'failed' : 'pending';
    }
}
