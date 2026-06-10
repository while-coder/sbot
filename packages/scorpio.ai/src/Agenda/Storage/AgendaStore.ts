import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { rm } from "fs/promises";
import path from "path";
import { inject } from "scorpio.di";
import { T_AgendaProfileDbPath, T_AgendaProfileId } from "../../Core";
import { IAgendaStore } from "./IAgendaStore";
import type {
    AgendaItemRow,
    AgendaOccurrenceRow,
    AgendaRecord,
    AgendaRecordInput,
    AgendaStoredItemRow,
    AgendaTriggerRow,
} from "../types";

const ITEM_ID_FACTOR = 1_000_000;
const CHILD_ID_FACTOR = 1_000;

type AgendaTable = "items" | "triggers" | "occurrences";

/**
 * 单 profile 的 agenda 存储。绑定一个 profileId + 一个 db 文件路径，构造后不再变化。
 * itemId/triggerId/occurrenceId 仍按 `profileId * 1_000_000 + ...` 编码，
 * 仅用于全局唯一与外部路由（路由职责由 sbot 侧的 pool 承担），store 自身不做跨 profile 反推。
 */
export class AgendaStore implements IAgendaStore {
    private lock = Promise.resolve();

    constructor(
        @inject(T_AgendaProfileId) private readonly profileId: number,
        @inject(T_AgendaProfileDbPath) private readonly dbPath: string,
    ) {}

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

    private open(): Database.Database {
        const dir = path.dirname(this.dbPath);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        const db = new Database(this.dbPath);
        db.pragma("journal_mode = WAL");
        this.ensureSchema(db);
        return db;
    }

    private openExisting(): Database.Database | null {
        if (!existsSync(this.dbPath)) return null;
        return this.open();
    }

    private ensureSchema(db: Database.Database): void {
        db.exec(`
            CREATE TABLE IF NOT EXISTS items (
                id                INTEGER PRIMARY KEY,
                content           TEXT    NOT NULL,
                status            TEXT    NOT NULL,
                priority          TEXT    NOT NULL,
                category          TEXT    NOT NULL,
                completionMode    TEXT    NOT NULL,
                dueAt             INTEGER,
                source            TEXT    NOT NULL,
                createdAt         INTEGER NOT NULL,
                updatedAt         INTEGER NOT NULL,
                doneAt            INTEGER
            );
            CREATE TABLE IF NOT EXISTS triggers (
                id             INTEGER PRIMARY KEY,
                itemId         INTEGER NOT NULL,
                kind           TEXT    NOT NULL,
                expr           TEXT    NOT NULL,
                timezone       TEXT,
                action         TEXT    NOT NULL,
                message        TEXT,
                channelHint    INTEGER NOT NULL,
                enabled        INTEGER NOT NULL,
                fireCount      INTEGER NOT NULL,
                maxFires       INTEGER NOT NULL,
                lastFiredAt    INTEGER,
                nextFireAt     INTEGER,
                skipNextFireAt INTEGER,
                skipFireCount  INTEGER,
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
        `);
    }

    private readAgendaRecordFromDb(db: Database.Database, itemId: number): AgendaRecord | null {
        const storedItem = db.prepare("SELECT * FROM items WHERE id = ?").get(itemId) as AgendaStoredItemRow | undefined;
        if (!storedItem) return null;
        return this.buildAgendaRecord(db, storedItem);
    }

    private buildAgendaRecord(db: Database.Database, storedItem: AgendaStoredItemRow): AgendaRecord {
        const item = { ...storedItem, profileId: this.profileId };
        const triggers = (db.prepare("SELECT * FROM triggers WHERE itemId = ? ORDER BY id").all(item.id) as any[]).map(row => ({
            ...row,
            enabled: Boolean(row.enabled),
        })) as AgendaTriggerRow[];
        const occurrences = db.prepare("SELECT * FROM occurrences WHERE itemId = ? ORDER BY scheduledAt, id").all(item.id) as AgendaOccurrenceRow[];
        return { item, triggers, occurrences };
    }

    private insertAgendaRecord(db: Database.Database, data: AgendaRecord): void {
        db.prepare(`
            INSERT INTO items (
                id, content, status, priority, category, completionMode,
                dueAt, source, createdAt, updatedAt, doneAt
            ) VALUES (
                @id, @content, @status, @priority, @category, @completionMode,
                @dueAt, @source, @createdAt, @updatedAt, @doneAt
            )
        `).run(this.toStoredItem(data.item));
        const insertTrigger = db.prepare(`
            INSERT INTO triggers (
                id, itemId, kind, expr, timezone, action, message, channelHint, enabled,
                fireCount, maxFires, lastFiredAt, nextFireAt, skipNextFireAt,
                skipFireCount, createdAt
            ) VALUES (
                @id, @itemId, @kind, @expr, @timezone, @action, @message, @channelHint, @enabled,
                @fireCount, @maxFires, @lastFiredAt, @nextFireAt, @skipNextFireAt,
                @skipFireCount, @createdAt
            )
        `);
        for (const trigger of data.triggers) insertTrigger.run({ ...trigger, enabled: trigger.enabled ? 1 : 0 });
        const insertOccurrence = db.prepare(`
            INSERT INTO occurrences (id, itemId, scheduledAt, status, doneAt)
            VALUES (@id, @itemId, @scheduledAt, @status, @doneAt)
        `);
        for (const occurrence of data.occurrences) insertOccurrence.run(occurrence);
    }

    async listItems(): Promise<AgendaRecord[]> {
        const db = this.openExisting();
        if (!db) return [];
        try {
            const items = db.prepare("SELECT * FROM items ORDER BY id").all() as AgendaStoredItemRow[];
            return items.map(item => this.buildAgendaRecord(db, item));
        } finally {
            db.close();
        }
    }

    async findItem(itemId: number): Promise<AgendaRecord | null> {
        const db = this.openExisting();
        if (!db) return null;
        try {
            return this.readAgendaRecordFromDb(db, itemId);
        } finally {
            db.close();
        }
    }

    async findTrigger(triggerId: number): Promise<{ data: AgendaRecord; trigger: AgendaTriggerRow } | null> {
        const data = await this.findItem(this.inferItemIdFromChildId(triggerId));
        const trigger = data?.triggers.find(t => t.id === triggerId);
        return data && trigger ? { data, trigger } : null;
    }

    async listEnabledTriggers(): Promise<AgendaTriggerRow[]> {
        const triggers: AgendaTriggerRow[] = [];
        for (const record of await this.listItems()) {
            triggers.push(...record.triggers.filter(t => t.enabled));
        }
        return triggers.sort((a, b) => a.id - b.id);
    }

    async createItem(build: (id: number) => AgendaRecordInput): Promise<AgendaRecord> {
        return this.withLock(async () => {
            const db = this.open();
            try {
                const id = this.nextItemIdInDb(db);
                const input = build(id);
                const data: AgendaRecord = {
                    ...input,
                    item: { ...input.item, profileId: this.profileId },
                };
                db.transaction(() => this.insertAgendaRecord(db, data))();
                return data;
            } finally {
                db.close();
            }
        });
    }

    async updateItem(itemId: number, fields: Partial<AgendaStoredItemRow>): Promise<AgendaRecord | null> {
        return this.withLock(async () => {
            const db = this.openExisting();
            if (!db) return null;
            try {
                this.updateById(db, "items", itemId, fields);
                return this.readAgendaRecordFromDb(db, itemId);
            } finally {
                db.close();
            }
        });
    }

    async updateTrigger(triggerId: number, fields: Partial<AgendaTriggerRow>): Promise<AgendaRecord | null> {
        return this.withLock(async () => {
            const itemId = this.inferItemIdFromChildId(triggerId);
            const db = this.openExisting();
            if (!db) return null;
            try {
                if (!this.updateById(db, "triggers", triggerId, fields, new Set(["enabled"]))) return null;
                return this.readAgendaRecordFromDb(db, itemId);
            } finally {
                db.close();
            }
        });
    }

    async updateActiveTriggersByItem(itemId: number, fields: Partial<AgendaTriggerRow>, exceptTriggerId?: number): Promise<number[]> {
        return this.withLock(async () => {
            const db = this.openExisting();
            if (!db) return [];
            try {
                const rows = db.prepare("SELECT id FROM triggers WHERE itemId = ? AND enabled = 1 ORDER BY id").all(itemId) as Array<{ id: number }>;
                const ids: number[] = [];
                for (const row of rows) {
                    if (row.id === exceptTriggerId) continue;
                    ids.push(row.id);
                    this.updateById(db, "triggers", row.id, fields, new Set(["enabled"]));
                }
                return ids;
            } finally {
                db.close();
            }
        });
    }

    async appendTrigger(itemId: number, trigger: Omit<AgendaTriggerRow, "id">): Promise<AgendaTriggerRow | null> {
        return this.withLock(async () => {
            const db = this.openExisting();
            if (!db) return null;
            try {
                if (!this.hasItem(db, itemId)) return null;
                const row = { ...trigger, id: this.nextChildIdInDb(db, "triggers", itemId) };
                db.prepare(`
                    INSERT INTO triggers (
                        id, itemId, kind, expr, timezone, action, message, channelHint, enabled,
                        fireCount, maxFires, lastFiredAt, nextFireAt, skipNextFireAt,
                        skipFireCount, createdAt
                    ) VALUES (
                        @id, @itemId, @kind, @expr, @timezone, @action, @message, @channelHint, @enabled,
                        @fireCount, @maxFires, @lastFiredAt, @nextFireAt, @skipNextFireAt,
                        @skipFireCount, @createdAt
                    )
                `).run({ ...row, enabled: row.enabled ? 1 : 0 });
                return row;
            } finally {
                db.close();
            }
        });
    }

    async appendOccurrence(itemId: number, occurrence: Omit<AgendaOccurrenceRow, "id">): Promise<AgendaOccurrenceRow | null> {
        return this.withLock(async () => {
            const db = this.openExisting();
            if (!db) return null;
            try {
                if (!this.hasItem(db, itemId)) return null;
                const row = { ...occurrence, id: this.nextChildIdInDb(db, "occurrences", itemId) };
                db.prepare(`
                    INSERT INTO occurrences (id, itemId, scheduledAt, status, doneAt)
                    VALUES (@id, @itemId, @scheduledAt, @status, @doneAt)
                `).run(row);
                return row;
            } finally {
                db.close();
            }
        });
    }

    async updateOccurrence(occurrenceId: number, fields: Partial<AgendaOccurrenceRow>): Promise<AgendaRecord | null> {
        return this.withLock(async () => {
            const itemId = this.inferItemIdFromChildId(occurrenceId);
            const db = this.openExisting();
            if (!db) return null;
            try {
                const changed = this.updateById(db, "occurrences", occurrenceId, fields);
                return changed ? this.readAgendaRecordFromDb(db, itemId) : null;
            } finally {
                db.close();
            }
        });
    }

    async deleteItem(itemId: number): Promise<AgendaRecord | null> {
        return this.withLock(async () => {
            const db = this.openExisting();
            if (!db) return null;
            try {
                const data = this.readAgendaRecordFromDb(db, itemId);
                if (!data) return null;
                db.transaction(() => {
                    db.prepare("DELETE FROM occurrences WHERE itemId = ?").run(itemId);
                    db.prepare("DELETE FROM triggers WHERE itemId = ?").run(itemId);
                    db.prepare("DELETE FROM items WHERE id = ?").run(itemId);
                })();
                return data;
            } finally {
                db.close();
            }
        });
    }

    async deleteAll(): Promise<number[]> {
        return this.withLock(async () => {
            const records = await this.listItems();
            const triggerIds = records.flatMap(record => record.triggers.map(t => t.id));
            await rm(path.dirname(this.dbPath), { recursive: true, force: true });
            return triggerIds;
        });
    }

    private nextItemIdInDb(db: Database.Database): number {
        const base = this.profileId * ITEM_ID_FACTOR;
        const row = db.prepare("SELECT MAX(id) AS id FROM items").get() as { id: number | null };
        return Math.max(base, row.id ?? 0) + 1;
    }

    private nextChildIdInDb(db: Database.Database, table: "triggers" | "occurrences", itemId: number): number {
        const base = itemId * CHILD_ID_FACTOR;
        const row = db.prepare(`SELECT MAX(id) AS id FROM ${table} WHERE itemId = ?`).get(itemId) as { id: number | null };
        return Math.max(base, row.id ?? 0) + 1;
    }

    private updateById(db: Database.Database, table: AgendaTable, id: number, fields: Record<string, any>, booleanFields = new Set<string>()): boolean {
        const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
        if (entries.length === 0) return false;
        const values = Object.fromEntries(entries.map(([key, value]) => [key, booleanFields.has(key) ? (value ? 1 : 0) : value]));
        const setSql = entries.map(([key]) => `${key} = @${key}`).join(", ");
        const result = db.prepare(`UPDATE ${table} SET ${setSql} WHERE id = @id`).run({ ...values, id });
        return result.changes > 0;
    }

    private hasItem(db: Database.Database, itemId: number): boolean {
        return Boolean(db.prepare("SELECT 1 FROM items WHERE id = ?").get(itemId));
    }

    private toStoredItem(item: AgendaItemRow): AgendaStoredItemRow {
        const { profileId: _profileId, ...stored } = item;
        return stored;
    }
}
