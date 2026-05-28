import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { inject, T_DBPath } from "../../Core";
import { Memory, MemoryResult } from "../types";
import { IMemoryDatabase } from "./IMemoryDatabase";
import { cosineSimilarity } from "../utils";

export class MemorySqliteDatabase implements IMemoryDatabase {
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
                CREATE TABLE IF NOT EXISTS memories (
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

    async getAllMemories(): Promise<Memory[]> {
        const rows = this.db.prepare(`SELECT * FROM memories`).all() as any[];
        return rows.map(row => this.rowToMemory(row));
    }

    async searchWithTimeDecay(
        queryEmbedding: number[],
        currentTime: number,
        decayFactor: number = 0.995,
        limit: number = 10
    ): Promise<MemoryResult[]> {
        return this.searchSimilar(queryEmbedding, limit * 2)
            .map(result => {
                const mem = result.memory;
                const hoursSinceCreation = (currentTime - mem.createdAt) / 3600000;
                const timeDecay = Math.pow(decayFactor, hoursSinceCreation);
                const recencyScore = Math.pow(0.5, hoursSinceCreation / 24);
                const accessScore = Math.log(mem.accessCount + 1) / 10;
                const score = result.score * timeDecay * 0.7
                    + recencyScore * 0.2
                    + accessScore * 0.1;
                return { memory: mem, score };
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    async findDuplicate(
        queryEmbedding: number[],
        threshold: number = 0.85
    ): Promise<{ memory: Memory; score: number } | undefined> {
        const [top] = this.searchSimilar(queryEmbedding, 1, threshold);
        return top ? { memory: top.memory, score: top.score } : undefined;
    }

    // ===== 写入 =====

    async insertMemory(memory: Memory): Promise<void> {
        this.db.prepare(`
            INSERT INTO memories (id, content, embedding, access_count,
                last_accessed, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            memory.id,
            memory.content,
            JSON.stringify(memory.embedding),
            memory.accessCount,
            memory.lastAccessed,
            memory.createdAt
        );
    }

    async updateMemory(id: string, content: string, embedding: number[]): Promise<void> {
        this.db.prepare(`
            UPDATE memories SET content = ?, embedding = ? WHERE id = ?
        `).run(content, JSON.stringify(embedding), id);
    }

    async updateAccess(memoryId: string): Promise<void> {
        this.db.prepare(
            `UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?`
        ).run(Date.now(), memoryId);
    }

    async deleteMemory(id: string): Promise<void> {
        this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
    }

    async clearMemories(): Promise<number> {
        return this.db.prepare(`DELETE FROM memories`).run().changes;
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
    ): Array<{ memory: Memory; distance: number; score: number }> {
        const rows = this.db.prepare(`SELECT * FROM memories`).all() as any[];

        let normQ = 0;
        for (const v of queryEmbedding) normQ += v * v;
        normQ = Math.sqrt(normQ);

        return rows
            .map(row => {
                const embedding: number[] = JSON.parse(row.embedding);
                const score = cosineSimilarity(queryEmbedding, embedding, normQ);
                if (score < minSimilarity) return null;
                return { memory: this.rowToMemory(row, embedding), distance: 1 - score, score };
            })
            .filter((r): r is NonNullable<typeof r> => r !== null)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    private rowToMemory(row: any, embedding?: number[]): Memory {
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
