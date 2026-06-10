import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { readdir, rm } from "fs/promises";
import path from "path";
import { config } from "../Core/Config";
import type { AgendaFireLogRow, AgendaItemRow, AgendaOccurrenceRow, AgendaStoredItemRow, AgendaTriggerRow } from "./types";

export interface AgendaRecord {
    item: AgendaItemRow;
    triggers: AgendaTriggerRow[];
    occurrences: AgendaOccurrenceRow[];
    fireLogs: AgendaFireLogRow[];
}

export interface AgendaRecordInput {
    item: AgendaStoredItemRow;
    triggers: AgendaTriggerRow[];
    occurrences: AgendaOccurrenceRow[];
    fireLogs: AgendaFireLogRow[];
}

export interface AgendaRecordRef {
    dbPath: string;
    data: AgendaRecord;
}

const AGENDA_DB_NAME = "agenda.db";
const ITEM_ID_FACTOR = 1_000_000;
const CHILD_ID_FACTOR = 1_000;

type AgendaTable = "items" | "triggers" | "occurrences";

class AgendaStore {
    private lock = Promise.resolve();

    profileDir(profileId: number): string {
        return config.getProfileAgendaPath(String(profileId));
    }

    private dbPath(profileId: number): string {
        return path.join(this.profileDir(profileId), AGENDA_DB_NAME);
    }

    private inferProfileId(itemId: number): number {
        return Math.floor(itemId / ITEM_ID_FACTOR);
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

    private openProfile(profileId: number): Database.Database {
        const filePath = this.dbPath(profileId);
        const dir = path.dirname(filePath);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        const db = new Database(filePath);
        db.pragma("journal_mode = WAL");
        this.ensureSchema(db);
        return db;
    }

    private openExistingProfile(profileId: number): Database.Database | null {
        if (!existsSync(this.dbPath(profileId))) return null;
        return this.openProfile(profileId);
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
                lastTouchedTurnId TEXT,
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
                graceWindowMs  INTEGER NOT NULL,
                skipNextFireAt INTEGER,
                skipFireCount  INTEGER,
                createdAt      INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS occurrences (
                id          INTEGER PRIMARY KEY,
                itemId      INTEGER NOT NULL,
                triggerId   INTEGER NOT NULL,
                scheduledAt INTEGER NOT NULL,
                status      TEXT    NOT NULL,
                doneAt      INTEGER,
                createdAt   INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS fire_logs (
                id               INTEGER PRIMARY KEY,
                itemId           INTEGER NOT NULL,
                triggerId        INTEGER NOT NULL,
                firedAt          INTEGER NOT NULL,
                action           TEXT    NOT NULL,
                channelSessionId INTEGER,
                ok               INTEGER NOT NULL,
                errorMessage     TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_items_status ON items (status, dueAt);
            CREATE INDEX IF NOT EXISTS idx_triggers_item ON triggers (itemId, id);
            CREATE INDEX IF NOT EXISTS idx_triggers_enabled ON triggers (enabled, nextFireAt);
            CREATE INDEX IF NOT EXISTS idx_occurrences_item_status ON occurrences (itemId, status, scheduledAt);
            CREATE INDEX IF NOT EXISTS idx_fire_logs_item_fired_at ON fire_logs (itemId, firedAt);
        `);
    }

    private readAgendaRecordFromDb(db: Database.Database, profileId: number, itemId: number): AgendaRecord | null {
        const storedItem = db.prepare("SELECT * FROM items WHERE id = ?").get(itemId) as AgendaStoredItemRow | undefined;
        if (!storedItem) return null;
        return this.buildAgendaRecord(db, profileId, storedItem);
    }

    private buildAgendaRecord(db: Database.Database, profileId: number, storedItem: AgendaStoredItemRow): AgendaRecord {
        const item = { ...storedItem, profileId };
        const triggers = (db.prepare("SELECT * FROM triggers WHERE itemId = ? ORDER BY id").all(item.id) as any[]).map(row => ({
            ...row,
            enabled: Boolean(row.enabled),
        })) as AgendaTriggerRow[];
        const occurrences = db.prepare("SELECT * FROM occurrences WHERE itemId = ? ORDER BY scheduledAt, id").all(item.id) as AgendaOccurrenceRow[];
        const fireLogs = (db.prepare("SELECT * FROM fire_logs WHERE itemId = ? ORDER BY firedAt DESC, id DESC").all(item.id) as any[]).map(row => ({
            ...row,
            ok: Boolean(row.ok),
        })) as AgendaFireLogRow[];
        return { item, triggers, occurrences, fireLogs };
    }

    private insertAgendaRecord(db: Database.Database, data: AgendaRecord): void {
        db.prepare(`
            INSERT INTO items (
                id, content, status, priority, category, completionMode,
                dueAt, source, lastTouchedTurnId, createdAt, updatedAt, doneAt
            ) VALUES (
                @id, @content, @status, @priority, @category, @completionMode,
                @dueAt, @source, @lastTouchedTurnId, @createdAt, @updatedAt, @doneAt
            )
        `).run(this.toStoredItem(data.item));
        const insertTrigger = db.prepare(`
            INSERT INTO triggers (
                id, itemId, kind, expr, timezone, action, message, channelHint, enabled,
                fireCount, maxFires, lastFiredAt, nextFireAt, graceWindowMs, skipNextFireAt,
                skipFireCount, createdAt
            ) VALUES (
                @id, @itemId, @kind, @expr, @timezone, @action, @message, @channelHint, @enabled,
                @fireCount, @maxFires, @lastFiredAt, @nextFireAt, @graceWindowMs, @skipNextFireAt,
                @skipFireCount, @createdAt
            )
        `);
        for (const trigger of data.triggers) insertTrigger.run({ ...trigger, enabled: trigger.enabled ? 1 : 0 });
        const insertOccurrence = db.prepare(`
            INSERT INTO occurrences (id, itemId, triggerId, scheduledAt, status, doneAt, createdAt)
            VALUES (@id, @itemId, @triggerId, @scheduledAt, @status, @doneAt, @createdAt)
        `);
        for (const occurrence of data.occurrences) insertOccurrence.run(occurrence);
        const insertFireLog = db.prepare(`
            INSERT INTO fire_logs (id, itemId, triggerId, firedAt, action, channelSessionId, ok, errorMessage)
            VALUES (@id, @itemId, @triggerId, @firedAt, @action, @channelSessionId, @ok, @errorMessage)
        `);
        for (const log of data.fireLogs) insertFireLog.run({ ...log, ok: log.ok ? 1 : 0 });
    }

    async listProfileItems(profileId: number): Promise<AgendaRecordRef[]> {
        const db = this.openExistingProfile(profileId);
        if (!db) return [];
        try {
            const items = db.prepare("SELECT * FROM items ORDER BY id").all() as AgendaStoredItemRow[];
            const dbPath = this.dbPath(profileId);
            return items.map(item => ({ dbPath, data: this.buildAgendaRecord(db, profileId, item) }));
        } finally {
            db.close();
        }
    }

    async listAllItems(): Promise<AgendaRecordRef[]> {
        const profilesDir = config.getConfigPath("profiles", true);
        if (!existsSync(profilesDir)) return [];
        const result: AgendaRecordRef[] = [];
        const entries = await readdir(profilesDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const profileId = Number(entry.name);
            if (!Number.isInteger(profileId) || profileId <= 0) continue;
            result.push(...await this.listProfileItems(profileId));
        }
        return result.sort((a, b) => a.data.item.profileId - b.data.item.profileId || a.data.item.id - b.data.item.id);
    }

    async findByItemId(itemId: number): Promise<AgendaRecordRef | null> {
        const profileId = this.inferProfileId(itemId);
        if (profileId > 0) {
            const db = this.openExistingProfile(profileId);
            if (db) {
                try {
                    const data = this.readAgendaRecordFromDb(db, profileId, itemId);
                    if (data) return { dbPath: this.dbPath(profileId), data };
                } finally {
                    db.close();
                }
            }
        }
        return null;
    }

    async findByTriggerId(triggerId: number): Promise<{ dbPath: string; data: AgendaRecord; trigger: AgendaTriggerRow } | null> {
        const ref = await this.findByItemId(this.inferItemIdFromChildId(triggerId));
        const trigger = ref?.data.triggers.find(t => t.id === triggerId);
        return ref && trigger ? { ...ref, trigger } : null;
    }

    async listEnabledTriggers(): Promise<AgendaTriggerRow[]> {
        const triggers: AgendaTriggerRow[] = [];
        for (const ref of await this.listAllItems()) {
            triggers.push(...ref.data.triggers.filter(t => t.enabled));
        }
        return triggers.sort((a, b) => a.id - b.id);
    }

    async createItem(profileId: number, build: (id: number) => AgendaRecordInput): Promise<AgendaRecord> {
        return this.withLock(async () => {
            const db = this.openProfile(profileId);
            try {
                const id = this.nextItemIdInDb(db, profileId);
                const input = build(id);
                const data: AgendaRecord = {
                    ...input,
                    item: { ...input.item, profileId },
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
            const profileId = this.inferProfileId(itemId);
            const db = this.openExistingProfile(profileId);
            if (!db) return null;
            try {
                this.updateById(db, "items", itemId, fields);
                return this.readAgendaRecordFromDb(db, profileId, itemId);
            } finally {
                db.close();
            }
        });
    }

    async updateTrigger(triggerId: number, fields: Partial<AgendaTriggerRow>): Promise<AgendaRecord | null> {
        return this.withLock(async () => {
            const itemId = this.inferItemIdFromChildId(triggerId);
            const profileId = this.inferProfileId(itemId);
            const db = this.openExistingProfile(profileId);
            if (!db) return null;
            try {
                if (!this.updateById(db, "triggers", triggerId, fields, new Set(["enabled"]))) return null;
                return this.readAgendaRecordFromDb(db, profileId, itemId);
            } finally {
                db.close();
            }
        });
    }

    async updateActiveTriggersByItem(itemId: number, fields: Partial<AgendaTriggerRow>, exceptTriggerId?: number): Promise<number[]> {
        return this.withLock(async () => {
            const profileId = this.inferProfileId(itemId);
            const db = this.openExistingProfile(profileId);
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
            const profileId = this.inferProfileId(itemId);
            const db = this.openExistingProfile(profileId);
            if (!db) return null;
            try {
                if (!this.hasItem(db, itemId)) return null;
                const row = { ...trigger, id: this.nextChildIdInDb(db, "triggers", itemId) };
                db.prepare(`
                    INSERT INTO triggers (
                        id, itemId, kind, expr, timezone, action, message, channelHint, enabled,
                        fireCount, maxFires, lastFiredAt, nextFireAt, graceWindowMs, skipNextFireAt,
                        skipFireCount, createdAt
                    ) VALUES (
                        @id, @itemId, @kind, @expr, @timezone, @action, @message, @channelHint, @enabled,
                        @fireCount, @maxFires, @lastFiredAt, @nextFireAt, @graceWindowMs, @skipNextFireAt,
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
            const profileId = this.inferProfileId(itemId);
            const db = this.openExistingProfile(profileId);
            if (!db) return null;
            try {
                if (!this.hasItem(db, itemId)) return null;
                const row = { ...occurrence, id: this.nextChildIdInDb(db, "occurrences", itemId) };
                db.prepare(`
                    INSERT INTO occurrences (id, itemId, triggerId, scheduledAt, status, doneAt, createdAt)
                    VALUES (@id, @itemId, @triggerId, @scheduledAt, @status, @doneAt, @createdAt)
                `).run(row);
                return row;
            } finally {
                db.close();
            }
        });
    }

    async appendFireLog(itemId: number, log: Omit<AgendaFireLogRow, "id">): Promise<AgendaFireLogRow | null> {
        return this.withLock(async () => {
            const profileId = this.inferProfileId(itemId);
            const db = this.openExistingProfile(profileId);
            if (!db) return null;
            try {
                if (!this.hasItem(db, itemId)) return null;
                const row = { ...log, id: this.nextFireLogIdInDb(db, itemId) };
                db.prepare(`
                    INSERT INTO fire_logs (id, itemId, triggerId, firedAt, action, channelSessionId, ok, errorMessage)
                    VALUES (@id, @itemId, @triggerId, @firedAt, @action, @channelSessionId, @ok, @errorMessage)
                `).run({ ...row, ok: row.ok ? 1 : 0 });
                return row;
            } finally {
                db.close();
            }
        });
    }

    async updateOccurrence(occurrenceId: number, fields: Partial<AgendaOccurrenceRow>): Promise<AgendaRecord | null> {
        return this.withLock(async () => {
            const itemId = this.inferItemIdFromChildId(occurrenceId);
            const profileId = this.inferProfileId(itemId);
            const db = this.openExistingProfile(profileId);
            if (!db) return null;
            try {
                const changed = this.updateById(db, "occurrences", occurrenceId, fields);
                return changed ? this.readAgendaRecordFromDb(db, profileId, itemId) : null;
            } finally {
                db.close();
            }
        });
    }

    async deleteItem(itemId: number): Promise<AgendaRecord | null> {
        return this.withLock(async () => {
            const profileId = this.inferProfileId(itemId);
            const db = this.openExistingProfile(profileId);
            if (!db) return null;
            try {
                const data = this.readAgendaRecordFromDb(db, profileId, itemId);
                if (!data) return null;
                db.transaction(() => {
                    db.prepare("DELETE FROM fire_logs WHERE itemId = ?").run(itemId);
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

    async deleteProfile(profileId: number): Promise<number[]> {
        return this.withLock(async () => {
            const records = await this.listProfileItems(profileId);
            const triggerIds = records.flatMap(record => record.data.triggers.map(t => t.id));
            await rm(this.profileDir(profileId), { recursive: true, force: true });
            return triggerIds;
        });
    }

    private nextItemIdInDb(db: Database.Database, profileId: number): number {
        const base = profileId * ITEM_ID_FACTOR;
        const row = db.prepare("SELECT MAX(id) AS id FROM items").get() as { id: number | null };
        return Math.max(base, row.id ?? 0) + 1;
    }

    private nextChildIdInDb(db: Database.Database, table: "triggers" | "occurrences", itemId: number): number {
        const base = itemId * CHILD_ID_FACTOR;
        const row = db.prepare(`SELECT MAX(id) AS id FROM ${table} WHERE itemId = ?`).get(itemId) as { id: number | null };
        return Math.max(base, row.id ?? 0) + 1;
    }

    private nextFireLogIdInDb(db: Database.Database, itemId: number): number {
        const base = itemId * CHILD_ID_FACTOR;
        const row = db.prepare("SELECT MAX(id) AS id FROM fire_logs WHERE itemId = ?").get(itemId) as { id: number | null };
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

export const agendaStore = new AgendaStore();
