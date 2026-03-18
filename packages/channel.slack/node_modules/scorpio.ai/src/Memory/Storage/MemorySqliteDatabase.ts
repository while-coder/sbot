import Database from "better-sqlite3";
import { inject, T_DBPath, T_ThreadId } from "../../Core";
import { Memory } from "../types";
import { IMemoryDatabase } from "./IMemoryDatabase";
import { cosineSimilarity } from "../utils";

export class MemorySqliteDatabase implements IMemoryDatabase {
    private db: Database.Database;

    readonly threadId: string;

    constructor(
        @inject(T_ThreadId) threadId: string,
        @inject(T_DBPath) dbPath: string,
    ) {
        this.threadId = threadId;
        this.db = new Database(dbPath);
        this.db.pragma("journal_mode = WAL");
        this.initTables();
    }

    // ===== 公开方法 =====

    async insertMemory(memory: Memory): Promise<void> {
        const { importance, accessCount, lastAccessed, timestamp, ...rest } = memory.metadata;

        this.db.prepare(`
            INSERT INTO memories (id, thread_id, content, embedding, importance, access_count,
                last_accessed, metadata, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            memory.id,
            this.threadId,
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
        return this.db.prepare(`DELETE FROM memories WHERE thread_id = ?`).run(this.threadId).changes;
    }

    async getAllThreadIds(): Promise<string[]> {
        const rows = this.db.prepare(
            `SELECT DISTINCT thread_id FROM memories ORDER BY thread_id`
        ).all() as { thread_id: string }[];
        return rows.map(r => r.thread_id);
    }

    async getAllMemories(): Promise<Memory[]> {
        const rows = this.db.prepare(`SELECT * FROM memories WHERE thread_id = ?`).all(this.threadId) as any[];
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
                const hoursSinceCreation = (currentTime - result.memory.metadata.timestamp) / 3600000;
                const timeDecay = Math.pow(decayFactor, hoursSinceCreation);
                return { ...result, decayedScore: result.score * timeDecay };
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
        this.db.close();
    }

    // ===== 私有方法 =====

    private initTables(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS memories (
                id            TEXT    PRIMARY KEY,
                thread_id     TEXT    NOT NULL,
                content       TEXT    NOT NULL,
                embedding     TEXT    NOT NULL,
                importance    REAL    NOT NULL DEFAULT 0.5,
                access_count  INTEGER NOT NULL DEFAULT 0,
                last_accessed INTEGER NOT NULL,
                metadata      TEXT,
                created_at    INTEGER NOT NULL,
                updated_at    INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_memories_thread_id ON memories(thread_id);
            CREATE INDEX IF NOT EXISTS idx_memories_prune ON memories(created_at, importance, access_count);
        `);
    }

    private searchSimilar(
        queryEmbedding: number[],
        limit: number = 10,
        minSimilarity: number = 0.3
    ): Array<{ memory: Memory; distance: number; score: number }> {
        const rows = this.db.prepare(
            `SELECT * FROM memories WHERE thread_id = ?`
        ).all(this.threadId) as any[];

        // 预计算查询向量的模长，避免在每次比较时重复计算
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
