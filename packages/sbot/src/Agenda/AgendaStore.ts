import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { readdir, rm } from "fs/promises";
import path from "path";
import { config } from "../Core/Config";
import type { AgendaFireLogRow, AgendaItemRow, AgendaOccurrenceRow, AgendaStoredItemRow, AgendaTriggerRow } from "./types";

export interface AgendaFile {
    state: AgendaFileState;
    item: AgendaItemRow;
    triggers: AgendaTriggerRow[];
    occurrences: AgendaOccurrenceRow[];
    fireLogs: AgendaFireLogRow[];
}

export interface AgendaFileInput {
    item: AgendaStoredItemRow;
    triggers: AgendaTriggerRow[];
    occurrences: AgendaOccurrenceRow[];
    fireLogs: AgendaFireLogRow[];
}

export interface AgendaFileRef {
    filePath: string;
    data: AgendaFile;
}

type AgendaFileState = Record<string, string>;

const ITEM_ID_FACTOR = 1_000_000;
const CHILD_ID_FACTOR = 1_000;
const AGENDA_FILE_SCHEMA_VERSION = "1";

class AgendaStore {
    private lock = Promise.resolve();

    profileDir(profileId: number): string {
        return config.getProfileAgendaPath(String(profileId));
    }

    private filePath(profileId: number, itemId: number): string {
        return path.join(this.profileDir(profileId), `${itemId}.db`);
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

    private open(filePath: string): Database.Database {
        const dir = path.dirname(filePath);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        const db = new Database(filePath);
        db.pragma("journal_mode = WAL");
        db.exec(`
            CREATE TABLE IF NOT EXISTS item (
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
            CREATE TABLE IF NOT EXISTS state (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
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
            CREATE INDEX IF NOT EXISTS idx_triggers_enabled ON triggers (enabled, nextFireAt);
            CREATE INDEX IF NOT EXISTS idx_occurrences_status ON occurrences (status, scheduledAt);
            CREATE INDEX IF NOT EXISTS idx_fire_logs_fired_at ON fire_logs (firedAt);
        `);
        return db;
    }

    private readAgendaFile(filePath: string, profileId: number): AgendaFile | null {
        if (!existsSync(filePath)) return null;
        const db = this.open(filePath);
        try {
            const state = this.readState(db, profileId);
            const storedItem = db.prepare("SELECT * FROM item LIMIT 1").get() as AgendaStoredItemRow | undefined;
            const item = storedItem ? { ...storedItem, profileId } : undefined;
            if (!item) return null;
            const triggers = (db.prepare("SELECT * FROM triggers ORDER BY id").all() as any[]).map(row => ({
                ...row,
                enabled: Boolean(row.enabled),
            })) as AgendaTriggerRow[];
            const occurrences = db.prepare("SELECT * FROM occurrences ORDER BY scheduledAt, id").all() as AgendaOccurrenceRow[];
            const fireLogs = (db.prepare("SELECT * FROM fire_logs ORDER BY firedAt DESC, id DESC").all() as any[]).map(row => ({
                ...row,
                ok: Boolean(row.ok),
            })) as AgendaFireLogRow[];
            return { state, item, triggers, occurrences, fireLogs };
        } finally {
            db.close();
        }
    }

    private writeAgendaFile(filePath: string, data: AgendaFile): void {
        const db = this.open(filePath);
        try {
            const txn = db.transaction(() => {
                db.prepare("DELETE FROM state").run();
                db.prepare("DELETE FROM item").run();
                db.prepare("DELETE FROM triggers").run();
                db.prepare("DELETE FROM occurrences").run();
                db.prepare("DELETE FROM fire_logs").run();

                const insertState = db.prepare("INSERT INTO state (key, value) VALUES (@key, @value)");
                for (const [key, value] of Object.entries(this.normalizeState(data.state, data.item.profileId))) {
                    insertState.run({ key, value });
                }

                db.prepare(`
                    INSERT INTO item (
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
            });
            txn();
        } finally {
            db.close();
        }
    }

    private async profileFiles(profileId: number): Promise<string[]> {
        const dir = this.profileDir(profileId);
        if (!existsSync(dir)) return [];
        const entries = await readdir(dir, { withFileTypes: true });
        return entries
            .filter(entry => entry.isFile() && entry.name.endsWith(".db"))
            .map(entry => path.join(dir, entry.name));
    }

    async listProfileFiles(profileId: number): Promise<AgendaFileRef[]> {
        const result: AgendaFileRef[] = [];
        for (const filePath of await this.profileFiles(profileId)) {
            const data = this.readAgendaFile(filePath, profileId);
            if (data) result.push({ filePath, data });
        }
        result.sort((a, b) => a.data.item.id - b.data.item.id);
        return result;
    }

    async listAllFiles(): Promise<AgendaFileRef[]> {
        const profilesDir = config.getConfigPath("profiles", true);
        if (!existsSync(profilesDir)) return [];
        const result: AgendaFileRef[] = [];
        const entries = await readdir(profilesDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const profileId = Number(entry.name);
            if (!Number.isInteger(profileId) || profileId <= 0) continue;
            result.push(...await this.listProfileFiles(profileId));
        }
        return result.sort((a, b) => a.data.item.profileId - b.data.item.profileId || a.data.item.id - b.data.item.id);
    }

    async findByItemId(itemId: number): Promise<AgendaFileRef | null> {
        const profileId = this.inferProfileId(itemId);
        if (profileId > 0) {
            const filePath = this.filePath(profileId, itemId);
            const data = this.readAgendaFile(filePath, profileId);
            if (data) return { filePath, data };
        }
        for (const ref of await this.listAllFiles()) {
            if (ref.data.item.id === itemId) return ref;
        }
        return null;
    }

    async findByTriggerId(triggerId: number): Promise<{ filePath: string; data: AgendaFile; trigger: AgendaTriggerRow } | null> {
        const ref = await this.findByItemId(this.inferItemIdFromChildId(triggerId));
        const trigger = ref?.data.triggers.find(t => t.id === triggerId);
        return ref && trigger ? { ...ref, trigger } : null;
    }

    async listEnabledTriggers(): Promise<AgendaTriggerRow[]> {
        const triggers: AgendaTriggerRow[] = [];
        for (const ref of await this.listAllFiles()) {
            triggers.push(...ref.data.triggers.filter(t => t.enabled));
        }
        return triggers.sort((a, b) => a.id - b.id);
    }

    async createItem(profileId: number, build: (id: number) => AgendaFileInput): Promise<AgendaFile> {
        return this.withLock(async () => {
            const id = await this.nextItemId(profileId);
            const input = build(id);
            const data: AgendaFile = {
                ...input,
                state: this.normalizeState({}, profileId),
                item: { ...input.item, profileId },
            };
            this.writeAgendaFile(this.filePath(profileId, id), data);
            return data;
        });
    }

    async updateItem(itemId: number, fields: Partial<AgendaStoredItemRow>): Promise<AgendaFile | null> {
        return this.withLock(async () => {
            const ref = await this.findByItemId(itemId);
            if (!ref) return null;
            ref.data.item = { ...ref.data.item, ...fields };
            this.writeAgendaFile(ref.filePath, ref.data);
            return ref.data;
        });
    }

    async updateTrigger(triggerId: number, fields: Partial<AgendaTriggerRow>): Promise<AgendaFile | null> {
        return this.withLock(async () => {
            const found = await this.findByTriggerId(triggerId);
            if (!found) return null;
            found.data.triggers = found.data.triggers.map(trigger =>
                trigger.id === triggerId ? { ...trigger, ...fields } : trigger
            );
            this.writeAgendaFile(found.filePath, found.data);
            return found.data;
        });
    }

    async updateActiveTriggersByItem(itemId: number, fields: Partial<AgendaTriggerRow>, exceptTriggerId?: number): Promise<number[]> {
        return this.withLock(async () => {
            const ref = await this.findByItemId(itemId);
            if (!ref) return [];
            const ids: number[] = [];
            ref.data.triggers = ref.data.triggers.map(trigger => {
                if (!trigger.enabled || trigger.id === exceptTriggerId) return trigger;
                ids.push(trigger.id);
                return { ...trigger, ...fields };
            });
            this.writeAgendaFile(ref.filePath, ref.data);
            return ids;
        });
    }

    async appendTrigger(itemId: number, trigger: Omit<AgendaTriggerRow, "id">): Promise<AgendaTriggerRow | null> {
        return this.withLock(async () => {
            const ref = await this.findByItemId(itemId);
            if (!ref) return null;
            const row = { ...trigger, id: this.nextChildId(itemId, ref.data.triggers.map(t => t.id)) };
            ref.data.triggers.push(row);
            this.writeAgendaFile(ref.filePath, ref.data);
            return row;
        });
    }

    async appendOccurrence(itemId: number, occurrence: Omit<AgendaOccurrenceRow, "id">): Promise<AgendaOccurrenceRow | null> {
        return this.withLock(async () => {
            const ref = await this.findByItemId(itemId);
            if (!ref) return null;
            const row = { ...occurrence, id: this.nextChildId(itemId, ref.data.occurrences.map(o => o.id)) };
            ref.data.occurrences.push(row);
            this.writeAgendaFile(ref.filePath, ref.data);
            return row;
        });
    }

    async appendFireLog(itemId: number, log: Omit<AgendaFireLogRow, "id">): Promise<AgendaFireLogRow | null> {
        return this.withLock(async () => {
            const ref = await this.findByItemId(itemId);
            if (!ref) return null;
            const row = { ...log, id: this.nextChildId(itemId, ref.data.fireLogs.map(l => l.id)) };
            ref.data.fireLogs.push(row);
            this.writeAgendaFile(ref.filePath, ref.data);
            return row;
        });
    }

    async updateOccurrence(occurrenceId: number, fields: Partial<AgendaOccurrenceRow>): Promise<AgendaFile | null> {
        return this.withLock(async () => {
            const ref = await this.findByItemId(this.inferItemIdFromChildId(occurrenceId));
            if (!ref || !ref.data.occurrences.some(o => o.id === occurrenceId)) return null;
            ref.data.occurrences = ref.data.occurrences.map(o => o.id === occurrenceId ? { ...o, ...fields } : o);
            this.writeAgendaFile(ref.filePath, ref.data);
            return ref.data;
        });
    }

    async deleteItem(itemId: number): Promise<AgendaFile | null> {
        return this.withLock(async () => {
            const ref = await this.findByItemId(itemId);
            if (!ref) return null;
            await rm(ref.filePath, { force: true });
            await rm(`${ref.filePath}-wal`, { force: true });
            await rm(`${ref.filePath}-shm`, { force: true });
            return ref.data;
        });
    }

    async deleteProfile(profileId: number): Promise<number[]> {
        return this.withLock(async () => {
            const files = await this.listProfileFiles(profileId);
            const triggerIds = files.flatMap(file => file.data.triggers.map(t => t.id));
            await rm(this.profileDir(profileId), { recursive: true, force: true });
            return triggerIds;
        });
    }

    private async nextItemId(profileId: number): Promise<number> {
        const base = profileId * ITEM_ID_FACTOR;
        const ids = (await this.listProfileFiles(profileId)).map(ref => ref.data.item.id);
        return Math.max(base, ...ids) + 1;
    }

    private toStoredItem(item: AgendaItemRow): AgendaStoredItemRow {
        const { profileId: _profileId, ...stored } = item;
        return stored;
    }

    private readState(db: Database.Database, profileId: number): AgendaFileState {
        const rows = db.prepare("SELECT key, value FROM state").all() as Array<{ key: string; value: string }>;
        return this.normalizeState(Object.fromEntries(rows.map(row => [row.key, row.value])), profileId);
    }

    private normalizeState(state: AgendaFileState, profileId: number): AgendaFileState {
        return {
            ...state,
            schemaVersion: AGENDA_FILE_SCHEMA_VERSION,
            profileId: String(profileId),
        };
    }

    private nextChildId(itemId: number, ids: number[]): number {
        const base = itemId * CHILD_ID_FACTOR;
        return Math.max(base, ...ids) + 1;
    }
}

export const agendaStore = new AgendaStore();
