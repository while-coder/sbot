import { AsyncLocalStorage } from "async_hooks";
import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { rm } from "fs/promises";
import path from "path";
import { inject } from "scorpio.di";
import { T_AgendaDbPath } from "../../Core";
import type { ChatMessage } from "../../Saver";
import { ERROR_MESSAGE_MAX_LEN, PENDING_JOB_LIST_HARD_CAP } from "../limits";
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

type AgendaTable = "items" | "triggers" | "occurrences";

/**
 * 单 agenda 模板的存储。绑定一个 db 文件路径，构造后不再变化。
 * 通过 `get db()` 懒初始化 SQLite 连接，进程生命周期内复用同一连接，
 * 调用 `dispose()` 显式关闭。
 */
export class AgendaStore implements IAgendaStore {
    private _db: Database.Database | undefined;
    private lock = Promise.resolve();
    /**
     * 跨方法原子块（如 service.create 的 findNearDuplicate + createItem）调用 runExclusive，
     * 内部 store 方法仍 withLock 但因为同一 async 链已持锁，直接执行。
     * 不同 async 链（不同 caller）各自拿不到 store，正常排队。
     */
    private lockHeld = new AsyncLocalStorage<true>();

    constructor(
        @inject(T_AgendaDbPath) private readonly dbPath: string,
    ) {}

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
            // 启动 sweep：把上次进程崩溃留下的 'processing' 转回 'pending' 重新跑。
            // popPendingJob 用单条 UPDATE…RETURNING 把 job 标 'processing'，
            // 配合本 sweep 实现"崩溃恢复时不重复 LLM 调用 + 不丢 job"。
            this._db.prepare(`UPDATE agenda_pending_jobs SET status = 'pending' WHERE status = 'processing'`).run();
        }
        return this._db;
    }

    /** 反向查 child（trigger / occurrence）所属的 itemId。返回 null = 找不到这一行。 */
    private lookupItemIdForChild(table: "triggers" | "occurrences", childId: number): number | null {
        const row = this.db.prepare(`SELECT itemId FROM ${table} WHERE id = ?`).get(childId) as { itemId: number } | undefined;
        return row?.itemId ?? null;
    }

    private async withLock<T>(fn: () => Promise<T>): Promise<T> {
        // 同一 async 链已持锁 → 直接跑，不再排队（避免自死锁，让 runExclusive 内的子调用穿透）。
        if (this.lockHeld.getStore()) return fn();
        const previous = this.lock;
        let release!: () => void;
        this.lock = new Promise<void>(resolve => { release = resolve; });
        await previous;
        try {
            return await this.lockHeld.run(true, fn);
        } finally {
            release();
        }
    }

    /**
     * 把多次 store 调用绑成一个原子块。fn 内部的 store 方法（如 findItem / createItem）
     * 仍走 withLock，但都因 lockHeld 已持有而直接执行。
     * 用于 service 跨方法的 read-then-write（如 findNearDuplicate + createItem）。
     */
    async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
        return this.withLock(async () => fn());
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
        const itemId = this.lookupItemIdForChild("triggers", triggerId);
        if (itemId == null) return null;
        const data = await this.findItem(itemId);
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
            const itemId = this.lookupItemIdForChild("triggers", triggerId);
            if (itemId == null) return null;
            if (!this.updateById("triggers", triggerId, fields, new Set(["enabled"]))) return null;
            return this.readAgendaRecordFromDb(itemId);
        });
    }

    async updateActiveTriggersByItem(itemId: number, fields: Partial<AgendaTrigger>, exceptTriggerIds: number[]): Promise<number[]> {
        return this.withLock(async () => {
            if (!existsSync(this.dbPath)) return [];
            const rows = this.db.prepare("SELECT id FROM triggers WHERE itemId = ? AND enabled = 1 ORDER BY id").all(itemId) as Array<{ id: number }>;
            const except = new Set(exceptTriggerIds);
            const ids: number[] = [];
            for (const row of rows) {
                if (except.has(row.id)) continue;
                ids.push(row.id);
                this.updateById("triggers", row.id, fields, new Set(["enabled"]));
            }
            return ids;
        });
    }

    async appendTrigger(itemId: number, trigger: Omit<AgendaTrigger, "id">): Promise<AgendaTrigger | null> {
        return this.withLock(async () => {
            if (!this.hasItem(itemId)) return null;
            const row = { ...trigger, id: this.nextChildIdInDb("triggers") };
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
            const row = { ...occurrence, id: this.nextChildIdInDb("occurrences") };
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
            const itemId = this.lookupItemIdForChild("occurrences", occurrenceId);
            if (itemId == null) return null;
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
        // 单条 SQL 原子地把最早 pending 转为 processing 并返回。崩溃时 'processing' 行
        // 由进程下次 init() 的 sweep 转回 'pending'——不会丢 job 也不会重复消费。
        const row = this.db.prepare(`
            UPDATE agenda_pending_jobs
            SET status = 'processing', updated_at = @now
            WHERE id = (
                SELECT id FROM agenda_pending_jobs
                WHERE status = 'pending'
                ORDER BY id ASC
                LIMIT 1
            )
            RETURNING id, job_type, channel_session_id, payload_json, status, attempt_count, error_message, created_at, updated_at
        `).get({ now: Date.now() }) as any;
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
        `).run({ id, errorMessage: errorMessage.slice(0, ERROR_MESSAGE_MAX_LEN), now });
    }

    listPendingJobs(limit: number): PendingAgendaJobRow[] {
        const rows = this.db.prepare(`
            SELECT id, job_type, channel_session_id, payload_json, status, attempt_count, error_message, created_at, updated_at
            FROM agenda_pending_jobs
            ORDER BY id DESC
            LIMIT @limit
        `).all({ limit: Math.max(1, Math.min(limit, PENDING_JOB_LIST_HARD_CAP)) }) as any[];
        return rows.map(r => this.mapPendingRow(r));
    }

    private nextChildIdInDb(table: "triggers" | "occurrences"): number {
        const row = this.db.prepare(`SELECT MAX(id) AS id FROM ${table}`).get() as { id: number | null };
        return (row.id ?? 0) + 1;
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
