import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { inject, T_DBPath } from "../../Core";
import { Note, NoteResult } from "../types";
import { INoteDatabase } from "./INoteDatabase";
import { cosineSimilarity } from "../utils";

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
                    embedding     TEXT    NOT NULL,
                    access_count  INTEGER NOT NULL DEFAULT 0,
                    last_accessed INTEGER NOT NULL,
                    created_at    INTEGER NOT NULL
                );
            `);
        }
        return this._db;
    }

    // ===== 查询 =====

    async getAllNotes(): Promise<Note[]> {
        const rows = this.db.prepare(`SELECT * FROM notes`).all() as any[];
        return rows.map(row => this.rowToNote(row));
    }

    async searchWithTimeDecay(
        queryEmbedding: number[],
        currentTime: number,
        decayFactor: number = 0.995,
        limit: number = 10
    ): Promise<NoteResult[]> {
        return this.searchSimilar(queryEmbedding, limit * 2)
            .map(result => {
                const n = result.note;
                const hoursSinceCreation = (currentTime - n.createdAt) / 3600000;
                const timeDecay = Math.pow(decayFactor, hoursSinceCreation);
                const recencyScore = Math.pow(0.5, hoursSinceCreation / 24);
                const accessScore = Math.log(n.accessCount + 1) / 10;
                const score = result.score * timeDecay * 0.7
                    + recencyScore * 0.2
                    + accessScore * 0.1;
                return { note: n, score };
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    async findDuplicate(
        queryEmbedding: number[],
        threshold: number = 0.85
    ): Promise<{ note: Note; score: number } | undefined> {
        const [top] = this.searchSimilar(queryEmbedding, 1, threshold);
        return top ? { note: top.note, score: top.score } : undefined;
    }

    // ===== 写入 =====

    async insertNote(note: Note): Promise<void> {
        this.db.prepare(`
            INSERT INTO notes (id, content, embedding, access_count,
                last_accessed, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            note.id,
            note.content,
            JSON.stringify(note.embedding),
            note.accessCount,
            note.lastAccessed,
            note.createdAt
        );
    }

    async updateNote(id: string, content: string, embedding: number[]): Promise<void> {
        this.db.prepare(`
            UPDATE notes SET content = ?, embedding = ? WHERE id = ?
        `).run(content, JSON.stringify(embedding), id);
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

    private searchSimilar(
        queryEmbedding: number[],
        limit: number = 10,
        minSimilarity: number = 0.3
    ): Array<{ note: Note; distance: number; score: number }> {
        const rows = this.db.prepare(`SELECT * FROM notes`).all() as any[];

        let normQ = 0;
        for (const v of queryEmbedding) normQ += v * v;
        normQ = Math.sqrt(normQ);

        return rows
            .map(row => {
                const embedding: number[] = JSON.parse(row.embedding);
                const score = cosineSimilarity(queryEmbedding, embedding, normQ);
                if (score < minSimilarity) return null;
                return { note: this.rowToNote(row, embedding), distance: 1 - score, score };
            })
            .filter((r): r is NonNullable<typeof r> => r !== null)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    private rowToNote(row: any, embedding?: number[]): Note {
        return {
            id: row.id,
            content: row.content,
            embedding: embedding ?? JSON.parse(row.embedding),
            createdAt: row.created_at,
            accessCount: row.access_count,
            lastAccessed: row.last_accessed,
        };
    }
}
