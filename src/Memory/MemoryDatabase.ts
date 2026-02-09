import Database from "better-sqlite3";
import { Memory, MemoryType, MemoryMetadata } from "./types";

/**
 * 记忆数据库类
 * 使用 SQLite 存储记忆和向量嵌入
 */
export class MemoryDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding TEXT NOT NULL,
        metadata TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
      CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);
      CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(json_extract(metadata, '$.userId'));
    `);
  }

  insertMemory(memory: Memory): void {
    const stmt = this.db.prepare(`
      INSERT INTO memories (id, type, content, embedding, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      memory.id,
      memory.type,
      memory.content,
      JSON.stringify(memory.embedding),
      JSON.stringify(memory.metadata),
      memory.metadata.timestamp,
      memory.metadata.timestamp
    );
  }

  getAllMemories(userId: string): Memory[] {
    const stmt = this.db.prepare(`SELECT * FROM memories WHERE json_extract(metadata, '$.userId') = ?`);
    const rows = stmt.all(userId) as any[];
    return rows.map(row => this.rowToMemory(row));
  }

  searchWithTimeDecay(
    queryEmbedding: number[],
    currentTime: number,
    decayFactor: number = 0.995,
    limit: number = 10,
    type?: MemoryType,
    userId?: string
  ): Array<{ memory: Memory; distance: number; score: number; decayedScore: number }> {
    const results = this.searchSimilar(queryEmbedding, limit * 2, type, 0, userId);

    const decayedResults = results.map(result => {
      const hoursSinceCreation = (currentTime - result.memory.metadata.timestamp) / 3600000;
      const timeDecay = Math.pow(decayFactor, hoursSinceCreation);
      const decayedScore = result.score * timeDecay;

      return { ...result, decayedScore };
    });

    return decayedResults
      .sort((a, b) => b.decayedScore - a.decayedScore)
      .slice(0, limit);
  }

  updateMemoryAccess(memoryId: string): void {
    const stmt = this.db.prepare(`SELECT * FROM memories WHERE id = ?`);
    const row = stmt.get(memoryId) as any;
    if (!row) return;

    const metadata: MemoryMetadata = JSON.parse(row.metadata);
    const now = Date.now();
    metadata.accessCount += 1;
    metadata.lastAccessed = now;

    const update = this.db.prepare(`UPDATE memories SET metadata = ?, updated_at = ? WHERE id = ?`);
    update.run(JSON.stringify(metadata), now, memoryId);
  }

  deleteMemory(id: string): void {
    const stmt = this.db.prepare(`DELETE FROM memories WHERE id = ?`);
    stmt.run(id);
  }

  pruneMemories(
    maxAge: number,
    minImportance: number = 0.3,
    minAccessCount: number = 2
  ): number {
    const cutoffTime = Date.now() - maxAge;

    const stmt = this.db.prepare(`
      DELETE FROM memories
      WHERE created_at < ?
      AND json_extract(metadata, '$.importance') < ?
      AND json_extract(metadata, '$.accessCount') < ?
    `);

    const result = stmt.run(cutoffTime, minImportance, minAccessCount);
    return result.changes;
  }

  close(): void {
    this.db.close();
  }

  private searchSimilar(
    queryEmbedding: number[],
    limit: number = 10,
    type?: MemoryType,
    minImportance: number = 0,
    userId?: string
  ): Array<{ memory: Memory; distance: number; score: number }> {
    let query = `SELECT * FROM memories WHERE 1=1`;
    const params: any[] = [];

    if (type) {
      query += ` AND type = ?`;
      params.push(type);
    }

    if (userId) {
      query += ` AND json_extract(metadata, '$.userId') = ?`;
      params.push(userId);
    }

    if (minImportance > 0) {
      query += ` AND json_extract(metadata, '$.importance') >= ?`;
      params.push(minImportance);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];

    const results = rows.map(row => {
      const memory = this.rowToMemory(row);
      const distance = this.cosineSimilarity(queryEmbedding, memory.embedding);
      const score = 1 - distance;
      return { memory, distance, score };
    });

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("向量维度不匹配");
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    return (1 - similarity) / 2;
  }

  private rowToMemory(row: any): Memory {
    return {
      id: row.id,
      type: row.type as MemoryType,
      content: row.content,
      embedding: JSON.parse(row.embedding),
      metadata: JSON.parse(row.metadata)
    };
  }
}
