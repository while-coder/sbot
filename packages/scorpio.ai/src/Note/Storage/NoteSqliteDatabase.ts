import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { inject, T_DBPath } from "../../Core";
import { Note } from "../types";
import { INoteDatabase } from "./INoteDatabase";

/**
 * Note SQLite 存储。纯 CRUD，无向量逻辑（向量交给 HybridSearcher）。
 *
 * 兼容老库：旧 schema 里有 `embedding TEXT NOT NULL` 列；新写入路径不再涉及该列。
 * insertNote 检测到 NOT NULL 约束时降级为带 embedding 列的写法（写空 JSON）。
 */
export class NoteSqliteDatabase implements INoteDatabase {
    private _db: Database.Database | undefined;
    private readonly dbPath: string;

    constructor(
        @inject(T_DBPath) dbPath: string,
    ) {
        this.dbPath = dbPath;
    }

    private get db(): Database.Database {
        if (!this._db) {
            const dir = dirname(this.dbPath);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            this._db = new Database(this.dbPath);
            this._db.pragma("journal_mode = WAL");
            this._db.exec(`
                CREATE TABLE IF NOT EXISTS notes (
                    id            TEXT    PRIMARY KEY,
                    content       TEXT    NOT NULL,
                    access_count  INTEGER NOT NULL DEFAULT 0,
                    last_accessed INTEGER NOT NULL,
                    created_at    INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_notes_created ON notes(created_at DESC);
            `);
        }
        return this._db;
    }

    // ===== 查询 =====

    async getAllNotes(): Promise<Note[]> {
        const rows = this.db.prepare(`
            SELECT id, content, access_count, last_accessed, created_at
            FROM notes
        `).all() as any[];
        return rows.map(r => this.rowToNote(r));
    }

    async getNoteById(id: string): Promise<Note | null> {
        const row = this.db.prepare(`
            SELECT id, content, access_count, last_accessed, created_at
            FROM notes WHERE id = ?
        `).get(id) as any;
        return row ? this.rowToNote(row) : null;
    }

    // ===== 写入 =====

    async insertNote(note: Note): Promise<void> {
        try {
            this.db.prepare(`
                INSERT INTO notes (id, content, access_count, last_accessed, created_at)
                VALUES (?, ?, ?, ?, ?)
            `).run(note.id, note.content, note.accessCount, note.lastAccessed, note.createdAt);
        } catch (e: any) {
            // 老库 embedding 列设了 NOT NULL → 降级写空 JSON 占位
            if (e?.code === 'SQLITE_CONSTRAINT_NOTNULL' && /embedding/i.test(e.message ?? '')) {
                this.db.prepare(`
                    INSERT INTO notes (id, content, embedding, access_count, last_accessed, created_at)
                    VALUES (?, ?, '[]', ?, ?, ?)
                `).run(note.id, note.content, note.accessCount, note.lastAccessed, note.createdAt);
                return;
            }
            throw e;
        }
    }

    async updateNoteContent(id: string, content: string): Promise<void> {
        this.db.prepare(`UPDATE notes SET content = ? WHERE id = ?`).run(content, id);
    }

    async updateAccess(noteId: string): Promise<void> {
        this.db.prepare(
            `UPDATE notes SET access_count = access_count + 1, last_accessed = ? WHERE id = ?`
        ).run(Date.now(), noteId);
    }

    async deleteNote(id: string): Promise<void> {
        this.db.prepare(`DELETE FROM notes WHERE id = ?`).run(id);
    }

    async clearNotes(): Promise<number> {
        return this.db.prepare(`DELETE FROM notes`).run().changes;
    }

    // ===== 生命周期 =====

    async dispose(): Promise<void> {
        this._db?.close();
    }

    // ===== 私有方法 =====

    private rowToNote(row: any): Note {
        return {
            id: row.id,
            content: row.content,
            createdAt: row.created_at,
            accessCount: row.access_count,
            lastAccessed: row.last_accessed,
        };
    }
}
