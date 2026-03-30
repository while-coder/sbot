import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { inject, T_DBPath } from "../../Core";
import { Memory } from "../types";
import { IMemoryDatabase } from "./IMemoryDatabase";
import { cosineSimilarity } from "../utils";

// ─────────────────────────────────────────────────────────────────────────────
// MemorySqliteDatabase
// 直接读写指定的 SQLite 文件，懒初始化
// ─────────────────────────────────────────────────────────────────────────────

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
                    importance    REAL    NOT NULL DEFAULT 0.5,
                    access_count  INTEGER NOT NULL DEFAULT 0,
                    last_accessed INTEGER NOT NULL,
                    metadata      TEXT,
                    created_at    INTEGER NOT NULL,
                    updated_at    INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_memories_prune ON memories(created_at, importance, access_count);
            `);
        }
        return this._db;
    }

    // ===== 公开方法 =====

    async insertMemory(memory: Memory): Promise<void> {
        const { importance, accessCount, lastAccessed, timestamp, ...rest } = memory.metadata;

        this.db.prepare(`
            INSERT INTO memories (id, content, embedding, importance, access_count,
                last_accessed, metadata, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            memory.id,
            memory.content,
            JSON.stringify(memory.embedding),
            importance,
            accessCount,
            lastAccessed,
            Object.keys(rest).length > 0 ? JSON.stringify(rest) : null,
            timestamp,
            timestamp
        );
    }

    async clearMemories(): Promise<number> {
        return this.db.prepare(`DELETE FROM memories`).run().changes;
    }

    async getAllMemories(): Promise<Memory[]> {
        const rows = this.db.prepare(`SELECT * FROM memories`).all() as any[];
        return rows.map(row => this.rowToMemory(row));
    }

    async searchWithTimeDecay(
        queryEmbedding: number[],
        currentTime: number,
        decayFactor: number = 0.995,
        limit: number = 10
    ): Promise<Array<{ memory: Memory; distance: number; score: number; decayedScore: number }>> {
        return this.searchSimilar(queryEmbedding, limit * 2)
            .map(result => {
                const { metadata } = result.memory;
                const hoursSinceCreation = (currentTime - metadata.timestamp) / 3600000;
                const timeDecay = Math.pow(decayFactor, hoursSinceCreation);
                const recencyScore = Math.pow(0.5, hoursSinceCreation / 24);
                const accessScore = Math.log(metadata.accessCount + 1) / 10;
                const decayedScore = result.score * timeDecay * 0.5
                    + metadata.importance * 0.3
                    + recencyScore * 0.1
                    + accessScore * 0.1;
                return { ...result, decayedScore };
            })
            .sort((a, b) => b.decayedScore - a.decayedScore)
            .slice(0, limit);
    }

    async updateAccess(memoryId: string): Promise<void> {
        const now = Date.now();
        this.db.prepare(
            `UPDATE memories SET access_count = access_count + 1, last_accessed = ?, updated_at = ? WHERE id = ?`
        ).run(now, now, memoryId);
    }

    async findDuplicate(
        queryEmbedding: number[],
        threshold: number = 0.85
    ): Promise<{ memory: Memory; score: number } | undefined> {
        const [top] = this.searchSimilar(queryEmbedding, 1, threshold);
        return top ? { memory: top.memory, score: top.score } : undefined;
    }

    async deleteMemory(id: string): Promise<void> {
        this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
    }

    async pruneMemories(
        maxAge: number,
        minImportance: number = 0.3,
        minAccessCount: number = 2
    ): Promise<number> {
        const cutoffTime = Date.now() - maxAge;
        return this.db.prepare(`
            DELETE FROM memories
            WHERE created_at < ? AND importance < ? AND access_count < ?
        `).run(cutoffTime, minImportance, minAccessCount).changes;
    }

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
        const extraMetadata = row.metadata ? JSON.parse(row.metadata) : {};
        return {
            id: row.id,
            content: row.content,
            embedding: embedding ?? JSON.parse(row.embedding),
            metadata: {
                timestamp: row.created_at,
                importance: row.importance,
                accessCount: row.access_count,
                lastAccessed: row.last_accessed,
                ...extraMetadata
            }
        };
    }
}
