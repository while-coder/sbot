import Database from "better-sqlite3";
import { Memory, MemoryType, MemoryMetadata } from "./types";
import { LoggerService } from "../LoggerService";

const logger = LoggerService.getLogger("MemoryDatabase.ts");

/**
 * 记忆数据库类
 * 使用 SQLite 存储记忆和向量嵌入
 */
export class MemoryDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL"); // 提升并发性能
    this.initTables();
  }

  /**
   * 初始化数据库表
   */
  private initTables(): void {
    // 创建记忆表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding TEXT NOT NULL,  -- JSON 格式的向量数组
        metadata TEXT NOT NULL,   -- JSON 格式的元数据
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- 创建索引以提高查询性能
      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
      CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);
      CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(json_extract(metadata, '$.userId'));
    `);

    logger.info("记忆数据库表初始化完成");
  }

  /**
   * 插入新记忆
   */
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

    logger.debug(`插入记忆: ${memory.id}, 类型: ${memory.type}`);
  }

  /**
   * 批量插入记忆
   */
  batchInsertMemories(memories: Memory[]): void {
    const insert = this.db.prepare(`
      INSERT INTO memories (id, type, content, embedding, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((memories: Memory[]) => {
      for (const memory of memories) {
        insert.run(
          memory.id,
          memory.type,
          memory.content,
          JSON.stringify(memory.embedding),
          JSON.stringify(memory.metadata),
          memory.metadata.timestamp,
          memory.metadata.timestamp
        );
      }
    });

    insertMany(memories);
    logger.info(`批量插入 ${memories.length} 条记忆`);
  }

  /**
   * 根据 ID 获取记忆
   */
  getMemoryById(id: string): Memory | null {
    const stmt = this.db.prepare(`
      SELECT * FROM memories WHERE id = ?
    `);

    const row = stmt.get(id) as any;
    if (!row) return null;

    return this.rowToMemory(row);
  }

  /**
   * 获取用户的所有记忆
   */
  getAllMemories(userId: string): Memory[] {
    const stmt = this.db.prepare(`SELECT * FROM memories WHERE json_extract(metadata, '$.userId') = ?`);
    const rows = stmt.all(userId) as any[];
    return rows.map(row => this.rowToMemory(row));
  }

  /**
   * 向量相似度搜索
   * 使用余弦相似度计算
   */
  searchSimilar(
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

    // 计算余弦相似度
    const results = rows.map(row => {
      const memory = this.rowToMemory(row);
      const distance = this.cosineSimilarity(queryEmbedding, memory.embedding);
      const score = 1 - distance; // 转换为相似度分数

      return { memory, distance, score };
    });

    // 按相似度排序并返回 top-k
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * 时间衰减检索
   * 结合向量相似度和时间衰减因子
   */
  searchWithTimeDecay(
    queryEmbedding: number[],
    currentTime: number,
    decayFactor: number = 0.995,
    limit: number = 10,
    type?: MemoryType,
    userId?: string
  ): Array<{ memory: Memory; distance: number; score: number; decayedScore: number }> {
    const results = this.searchSimilar(queryEmbedding, limit * 2, type, 0, userId);

    // 应用时间衰减
    const decayedResults = results.map(result => {
      const hoursSinceCreation = (currentTime - result.memory.metadata.timestamp) / 3600000;
      const timeDecay = Math.pow(decayFactor, hoursSinceCreation);
      const decayedScore = result.score * timeDecay;

      return {
        ...result,
        decayedScore
      };
    });

    // 按衰减后的分数排序
    return decayedResults
      .sort((a, b) => b.decayedScore - a.decayedScore)
      .slice(0, limit);
  }

  /**
   * 混合检索
   * 结合向量相似度、关键词匹配、时间衰减
   */
  hybridSearch(
    queryEmbedding: number[],
    keywords: string[],
    currentTime: number,
    limit: number = 10,
    type?: MemoryType,
    userId?: string
  ): Array<{ memory: Memory; distance: number; score: number; finalScore: number }> {
    // 首先进行时间衰减检索
    const results = this.searchWithTimeDecay(
      queryEmbedding,
      currentTime,
      0.995,
      limit * 3,
      type,
      userId
    );

    // 应用关键词加权
    const hybridResults = results.map(result => {
      let keywordBonus = 0;

      // 检查内容中是否包含关键词
      for (const keyword of keywords) {
        if (result.memory.content.toLowerCase().includes(keyword.toLowerCase())) {
          keywordBonus += 0.1; // 每个匹配的关键词加 0.1
        }
      }

      const finalScore = result.decayedScore + Math.min(keywordBonus, 0.3); // 最多加 0.3

      return {
        memory: result.memory,
        distance: result.distance,
        score: result.score,
        finalScore
      };
    });

    // 按最终分数排序
    return hybridResults
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, limit);
  }

  /**
   * 更新记忆访问统计
   */
  updateMemoryAccess(memoryId: string): void {
    const memory = this.getMemoryById(memoryId);
    if (!memory) return;

    const now = Date.now();
    const updatedMetadata: MemoryMetadata = {
      ...memory.metadata,
      accessCount: memory.metadata.accessCount + 1,
      lastAccessed: now
    };

    const stmt = this.db.prepare(`
      UPDATE memories
      SET metadata = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(JSON.stringify(updatedMetadata), now, memoryId);
  }

  /**
   * 更新记忆内容
   */
  updateMemory(id: string, updates: Partial<Omit<Memory, 'id'>>): void {
    const memory = this.getMemoryById(id);
    if (!memory) {
      throw new Error(`记忆 ${id} 不存在`);
    }

    const updatedMemory: Memory = {
      ...memory,
      ...updates,
      metadata: {
        ...memory.metadata,
        ...updates.metadata
      }
    };

    const stmt = this.db.prepare(`
      UPDATE memories
      SET type = ?, content = ?, embedding = ?, metadata = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      updatedMemory.type,
      updatedMemory.content,
      JSON.stringify(updatedMemory.embedding),
      JSON.stringify(updatedMemory.metadata),
      Date.now(),
      id
    );
  }

  /**
   * 删除记忆
   */
  deleteMemory(id: string): void {
    const stmt = this.db.prepare(`DELETE FROM memories WHERE id = ?`);
    stmt.run(id);
    logger.debug(`删除记忆: ${id}`);
  }

  /**
   * 清理过期记忆
   * 基于年龄、重要性和访问频率
   */
  pruneMemories(
    maxAge: number, // 最大保留时间（毫秒）
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
    const deletedCount = result.changes;

    logger.info(`清理了 ${deletedCount} 条过期记忆`);
    return deletedCount;
  }

  /**
   * 根据用户ID清理所有记忆
   */
  clearUserMemories(userId: string): number {
    const stmt = this.db.prepare(`
      DELETE FROM memories
      WHERE json_extract(metadata, '$.userId') = ?
    `);

    const result = stmt.run(userId);
    logger.info(`清理用户 ${userId} 的所有记忆，共 ${result.changes} 条`);
    return result.changes;
  }

  /**
   * 获取记忆统计信息
   */
  getStatistics(userId?: string): {
    totalCount: number;
    byType: Record<MemoryType, number>;
    avgImportance: number;
    oldestMemory: number;
    newestMemory: number;
  } {
    let whereClause = "1=1";
    const params: any[] = [];

    if (userId) {
      whereClause = "json_extract(metadata, '$.userId') = ?";
      params.push(userId);
    }

    const totalStmt = this.db.prepare(`SELECT COUNT(*) as count FROM memories WHERE ${whereClause}`);
    const totalCount = (totalStmt.get(...params) as any).count;

    const byTypeStmt = this.db.prepare(`
      SELECT type, COUNT(*) as count FROM memories WHERE ${whereClause} GROUP BY type
    `);
    const byTypeRows = byTypeStmt.all(...params) as any[];
    const byType = byTypeRows.reduce((acc, row) => {
      acc[row.type as MemoryType] = row.count;
      return acc;
    }, {} as Record<MemoryType, number>);

    const avgStmt = this.db.prepare(`
      SELECT AVG(json_extract(metadata, '$.importance')) as avg FROM memories WHERE ${whereClause}
    `);
    const avgImportance = (avgStmt.get(...params) as any).avg || 0;

    const rangeStmt = this.db.prepare(`
      SELECT MIN(created_at) as oldest, MAX(created_at) as newest FROM memories WHERE ${whereClause}
    `);
    const range = rangeStmt.get(...params) as any;

    return {
      totalCount,
      byType,
      avgImportance,
      oldestMemory: range.oldest || 0,
      newestMemory: range.newest || 0
    };
  }

  /**
   * 执行数据库清理和优化
   */
  vacuum(): void {
    this.db.exec("VACUUM");
    logger.info("数据库已优化");
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    this.db.close();
    logger.debug("记忆数据库连接已关闭");
  }

  /**
   * 计算余弦相似度
   * 返回值范围 [0, 1]，0 表示完全相同，1 表示完全不同
   */
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

    // 将相似度 [-1, 1] 转换为距离 [0, 1]
    // 相似度 1 -> 距离 0（完全相同）
    // 相似度 -1 -> 距离 1（完全相反）
    return (1 - similarity) / 2;
  }

  /**
   * 将数据库行转换为 Memory 对象
   */
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
