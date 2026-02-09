import Database from "better-sqlite3";
import { Memory, MemoryType, MemoryMetadata } from "./types";
import { LoggerService } from "../LoggerService";

const logger = LoggerService.getLogger("MemoryDatabase.ts");

const CURRENT_SCHEMA_VERSION = 1;

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

  // ===== 公开方法 =====

  insertMemory(memory: Memory): void {
    const { userId, importance, accessCount, lastAccessed, sessionId, category, tags, timestamp, ...rest } = memory.metadata;

    const stmt = this.db.prepare(`
      INSERT INTO memories (id, type, content, embedding, user_id, importance, access_count,
        last_accessed, session_id, category, tags, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      memory.id,
      memory.type,
      memory.content,
      this.embeddingToBlob(memory.embedding),
      userId,
      importance,
      accessCount,
      lastAccessed,
      sessionId ?? null,
      category ?? null,
      tags ? JSON.stringify(tags) : null,
      Object.keys(rest).length > 0 ? JSON.stringify(rest) : null,
      timestamp,
      timestamp
    );
  }

  clearAllMemories(userId: string): number {
    const stmt = this.db.prepare(`DELETE FROM memories WHERE user_id = ?`);
    const result = stmt.run(userId);
    return result.changes;
  }

  getAllMemories(userId: string): Memory[] {
    const stmt = this.db.prepare(`SELECT * FROM memories WHERE user_id = ?`);
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
    const now = Date.now();
    const stmt = this.db.prepare(
      `UPDATE memories SET access_count = access_count + 1, last_accessed = ?, updated_at = ? WHERE id = ?`
    );
    stmt.run(now, now, memoryId);
  }

  /**
   * 查找重复记忆（cosine similarity >= threshold）
   * 返回最相似的一条，未找到返回 undefined
   */
  findDuplicate(
    queryEmbedding: number[],
    userId: string,
    threshold: number = 0.85
  ): { memory: Memory; score: number } | undefined {
    const results = this.searchSimilar(queryEmbedding, 1, undefined, 0, userId, threshold);
    return results.length > 0
      ? { memory: results[0].memory, score: results[0].score }
      : undefined;
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
      AND importance < ?
      AND access_count < ?
    `);

    const result = stmt.run(cutoffTime, minImportance, minAccessCount);
    return result.changes;
  }

  close(): void {
    this.db.close();
  }

  // ===== 私有方法 =====

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_schema_version (
        version INTEGER NOT NULL
      );
    `);

    const versionRow = this.db.prepare(
      `SELECT version FROM memory_schema_version LIMIT 1`
    ).get() as { version: number } | undefined;

    const currentVersion = versionRow?.version ?? 0;

    if (currentVersion < 1) {
      this.migrateToV1();
    }
  }

  private migrateToV1(): void {
    this.db.exec('BEGIN TRANSACTION');
    try {
      // 创建新表
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          content TEXT NOT NULL,
          embedding BLOB NOT NULL,
          user_id TEXT NOT NULL,
          importance REAL NOT NULL DEFAULT 0.5,
          access_count INTEGER NOT NULL DEFAULT 0,
          last_accessed INTEGER NOT NULL,
          session_id TEXT,
          category TEXT,
          tags TEXT,
          metadata TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);

      // 检查是否存在旧表（通过检查列结构判断）
      const tableInfo = this.db.prepare(`PRAGMA table_info(memories)`).all() as any[];
      const hasUserIdColumn = tableInfo.some((col: any) => col.name === 'user_id');

      if (!hasUserIdColumn && tableInfo.length > 0) {
        // 旧表存在，需要迁移
        logger.info("检测到旧版记忆表，开始迁移到 v1...");

        // 重命名旧表
        this.db.exec(`ALTER TABLE memories RENAME TO memories_old`);

        // 创建新表
        this.db.exec(`
          CREATE TABLE memories (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            content TEXT NOT NULL,
            embedding BLOB NOT NULL,
            user_id TEXT NOT NULL,
            importance REAL NOT NULL DEFAULT 0.5,
            access_count INTEGER NOT NULL DEFAULT 0,
            last_accessed INTEGER NOT NULL,
            session_id TEXT,
            category TEXT,
            tags TEXT,
            metadata TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          );
        `);

        // 迁移数据
        const rows = this.db.prepare(`SELECT * FROM memories_old`).all() as any[];
        const insertStmt = this.db.prepare(`
          INSERT INTO memories (id, type, content, embedding, user_id, importance, access_count,
            last_accessed, session_id, category, tags, metadata, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const row of rows) {
          const metadata: MemoryMetadata = JSON.parse(row.metadata);
          const embedding: number[] = JSON.parse(row.embedding);

          insertStmt.run(
            row.id,
            row.type,
            row.content,
            this.embeddingToBlob(embedding),
            metadata.userId ?? '',
            metadata.importance ?? 0.5,
            metadata.accessCount ?? 0,
            metadata.lastAccessed ?? row.updated_at,
            metadata.sessionId ?? null,
            metadata.category ?? null,
            metadata.tags ? JSON.stringify(metadata.tags) : null,
            row.metadata,
            row.created_at,
            row.updated_at
          );
        }

        logger.info(`迁移完成，共迁移 ${rows.length} 条记忆`);

        // 删除旧表
        this.db.exec(`DROP TABLE memories_old`);
      }

      // 创建索引
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_v2_user_id ON memories(user_id);
        CREATE INDEX IF NOT EXISTS idx_v2_prune ON memories(created_at, importance, access_count);
        CREATE INDEX IF NOT EXISTS idx_v2_user_type ON memories(user_id, type);
        CREATE INDEX IF NOT EXISTS idx_v2_user_category ON memories(user_id, category);
      `);

      // 更新版本
      this.db.exec(`DELETE FROM memory_schema_version`);
      this.db.exec(`INSERT INTO memory_schema_version (version) VALUES (${CURRENT_SCHEMA_VERSION})`);

      this.db.exec('COMMIT');
      logger.info(`记忆数据库 schema 版本已更新至 v${CURRENT_SCHEMA_VERSION}`);
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private searchSimilar(
    queryEmbedding: number[],
    limit: number = 10,
    type?: MemoryType,
    minImportance: number = 0,
    userId?: string,
    minSimilarity: number = 0.3
  ): Array<{ memory: Memory; distance: number; score: number }> {
    let query = `SELECT * FROM memories WHERE 1=1`;
    const params: any[] = [];

    if (type) {
      query += ` AND type = ?`;
      params.push(type);
    }

    if (userId) {
      query += ` AND user_id = ?`;
      params.push(userId);
    }

    if (minImportance > 0) {
      query += ` AND importance >= ?`;
      params.push(minImportance);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];

    const results = rows.map(row => {
      const memory = this.rowToMemory(row);
      const score = this.cosineSimilarity(queryEmbedding, memory.embedding);
      return { memory, distance: 1 - score, score };
    });

    return results
      .filter(r => r.score >= minSimilarity)
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

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;
    return dotProduct / denominator;
  }

  private embeddingToBlob(embedding: number[]): Buffer {
    const float32 = new Float32Array(embedding);
    return Buffer.from(float32.buffer);
  }

  private blobToEmbedding(blob: Buffer): number[] {
    const float32 = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
    return Array.from(float32);
  }

  private rowToMemory(row: any): Memory {
    const extraMetadata = row.metadata ? JSON.parse(row.metadata) : {};
    return {
      id: row.id,
      type: row.type as MemoryType,
      content: row.content,
      embedding: this.blobToEmbedding(row.embedding),
      metadata: {
        timestamp: row.created_at,
        userId: row.user_id,
        sessionId: row.session_id ?? undefined,
        importance: row.importance,
        accessCount: row.access_count,
        lastAccessed: row.last_accessed,
        tags: row.tags ? JSON.parse(row.tags) : undefined,
        category: row.category ?? undefined,
        ...extraMetadata
      }
    };
  }
}
