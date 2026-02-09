import { v4 as uuidv4 } from "uuid";
import { inject, init } from "../Core";
import { MemoryDatabase } from "./MemoryDatabase";
import { Memory, MemoryType, MemoryIndexEntry, MemoryDetail } from "./types";
import { MemoryEvaluator } from "./MemoryEvaluator";
import { MemoryCompressor, MergeStrategy } from "./MemoryCompressor";
import { MemoryExtractor } from "./MemoryExtractor";
import { IMemoryService } from "./index";
import { IEmbeddingService } from "../Embedding";
import { LoggerService } from "../LoggerService";
import { config } from "../Config";

const logger = LoggerService.getLogger("MemoryService.ts");

/**
 * 记忆服务
 * 提供记忆的添加、检索、管理功能
 */
export class MemoryService implements IMemoryService {
  private db: MemoryDatabase;
  private sessionId: string;
  private maxMemoryAgeDays: number;
  constructor(
    private userId: string,
    maxMemoryAgeDays: number | undefined,
    @inject(IEmbeddingService) private embeddings: IEmbeddingService,
    @inject(MemoryEvaluator, { optional: true }) private evaluator?: MemoryEvaluator,
    @inject(MemoryCompressor, { optional: true }) private compressor?: MemoryCompressor,
    @inject(MemoryExtractor, { optional: true }) private extractor?: MemoryExtractor,
  ) {
    this.userId = userId;
    this.sessionId = uuidv4();
    this.db = new MemoryDatabase(config.getUserMemoryPath(userId));
    this.maxMemoryAgeDays = maxMemoryAgeDays ?? 90;

    logger.info(`记忆服务已创建 - 用户: ${this.userId}, 会话: ${this.sessionId}`);
  }

  /**
   * 初始化服务
   */
  @init()
  async init(): Promise<void> {
    this.cleanupOldMemories().catch(err => {
      logger.error(`自动清理记忆失败: ${err.message}`);
    });
  }

  /**
   * 对话历史记忆化
   * 有 extractor 时提取知识点存为 SEMANTIC 记忆，否则存原始对话为 EPISODIC
   */
  async memorizeConversation(
    userMessage: string,
    assistantMessage: string,
    importance?: number
  ): Promise<void> {
    if (this.extractor) {
      try {
        const facts = await this.extractor.extract(userMessage, assistantMessage);
        if (facts.length === 0) {
          logger.debug("对话无需记忆，跳过存储");
          return;
        }
        for (const fact of facts) {
          await this.addMemory(
            fact.content,
            MemoryType.SEMANTIC,
            fact.importance,
            { category: fact.category, tags: fact.tags }
          );
        }
        return;
      } catch (error: any) {
        logger.warn(`知识提取失败，降级为原始对话存储: ${error.message}`);
      }
    }

    // fallback: 无 extractor 或提取失败时存原始对话
    const conversationText = `User: ${userMessage}\nAssistant: ${assistantMessage}`;
    await this.addMemory(
      conversationText,
      MemoryType.EPISODIC,
      importance,
      { conversationType: 'dialogue' }
    );
  }

  /**
   * 获取记忆摘要（用于注入到 prompt）
   */
  async getMemorySummary(query: string, maxTokens: number = 500): Promise<string> {
    const memories = await this.retrieveRelevantMemories(query, 10);

    if (memories.length === 0) return "";

    let summary = "# 关于用户的记忆\n\n";
    let currentTokens = 0;

    for (const memory of memories) {
      const timeAgo = this.formatTimeAgo(memory.metadata.timestamp);
      const label = memory.metadata.category ?? memory.type;
      const memoryText = `- (${label}, ${timeAgo}) ${memory.content}\n`;
      const tokens = memoryText.length / 4;

      if (currentTokens + tokens > maxTokens) break;

      summary += memoryText;
      currentTokens += tokens;
    }

    return summary;
  }

  /**
   * 获取紧凑记忆目录（用于注入到 prompt）
   */
  async getMemoryIndex(query: string, limit: number = 10): Promise<MemoryIndexEntry[]> {
    const memories = await this.retrieveRelevantMemories(query, limit);
    return memories.map(memory => ({
      id: memory.id.substring(0, 8),
      label: this.truncateContent(memory.content, 30),
      category: memory.metadata.category,
      timeAgo: this.formatTimeAgo(memory.metadata.timestamp),
      importance: memory.metadata.importance,
    }));
  }

  /**
   * 按 ID 获取记忆详情
   */
  async getMemoryDetails(memoryIds: string[]): Promise<MemoryDetail[]> {
    const memories = this.db.getMemoriesByIds(memoryIds, this.userId);
    for (const memory of memories) {
      this.db.updateMemoryAccess(memory.id);
    }
    return memories.map(memory => ({
      id: memory.id,
      content: memory.content,
      type: memory.type,
      category: memory.metadata.category,
      tags: memory.metadata.tags,
      timeAgo: this.formatTimeAgo(memory.metadata.timestamp),
      importance: memory.metadata.importance,
    }));
  }

  /**
   * 压缩相似记忆
   * @returns 压缩的记忆组数
   */
  async compressMemories(): Promise<number> {
    if (!this.compressor) {
      logger.warn("MemoryCompressor 未启用，跳过压缩");
      return 0;
    }

    try {
      const allMemories = this.db.getAllMemories(this.userId);
      if (allMemories.length < 2) return 0;

      const groups = this.compressor.findCompressibleGroups(allMemories);
      let compressedCount = 0;

      for (const group of groups) {
        const result = await this.compressor.compress(
          group,
          MergeStrategy.CHRONOLOGICAL,
          (text) => this.embeddings.embedQuery(text)
        );

        if (result) {
          this.db.insertMemory(result.compressedMemory);
          for (const id of result.sourceMemoryIds) {
            this.db.deleteMemory(id);
          }
          compressedCount++;
          logger.info(`压缩记忆组: ${result.summary}`);
        }
      }

      return compressedCount;
    } catch (error: any) {
      logger.error(`压缩记忆失败: ${error.message}`);
      return 0;
    }
  }

  /**
   * 清除用户的所有记忆
   */
  async clearAll(): Promise<number> {
    const count = this.db.clearAllMemories(this.userId);
    logger.info(`已清除用户 ${this.userId} 的 ${count} 条记忆`);
    return count;
  }

  /**
   * 释放资源
   */
  async dispose(): Promise<void> {
    this.db.close();
    logger.info(`记忆服务已关闭 - 用户: ${this.userId}`);
  }

  /**
   * 添加记忆
   */
  private async addMemory(
    content: string,
    type: MemoryType = MemoryType.EPISODIC,
    importance?: number,
    additionalMetadata?: Record<string, any>
  ): Promise<string> {
    try {
      const embedding = await this.embeddings.embedQuery(content);

      // 去重/更新：检查是否已存在高度相似的记忆
      const duplicate = this.db.findDuplicate(embedding, this.userId, 0.85);
      if (duplicate) {
        if (duplicate.memory.content === content) {
          // 内容完全相同 → 真正的重复，跳过
          this.db.updateMemoryAccess(duplicate.memory.id);
          return duplicate.memory.id;
        }
        // 内容不同但语义相似 → 同一知识点更新，替换旧记忆
        this.db.deleteMemory(duplicate.memory.id);
        logger.debug(`记忆更新: "${duplicate.memory.content}" → "${content}"`);
      }

      const finalImportance = importance ?? await this.evaluateImportance(content);

      const memory: Memory = {
        id: uuidv4(),
        type,
        content,
        embedding,
        metadata: {
          timestamp: Date.now(),
          userId: this.userId,
          sessionId: this.sessionId,
          importance: finalImportance,
          accessCount: 0,
          lastAccessed: Date.now(),
          ...additionalMetadata
        }
      };

      this.db.insertMemory(memory);

      return memory.id;
    } catch (error: any) {
      logger.error(`添加记忆失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 智能记忆检索
   */
  private async retrieveRelevantMemories(query: string, limit: number = 5): Promise<Memory[]> {
    try {
      const queryEmbedding = await this.embeddings.embedQuery(query);

      const results = this.db.searchWithTimeDecay(
        queryEmbedding, Date.now(), 0.995, limit * 2, undefined, this.userId
      );

      results.forEach(result => {
        this.db.updateMemoryAccess(result.memory.id);
      });

      const rankedMemories = this.rerankMemories(results.map(r => r.memory));

      return rankedMemories.slice(0, limit);
    } catch (error: any) {
      logger.error(`检索记忆失败: ${error.message}`);
      return [];
    }
  }

  /**
   * 记忆重排序
   */
  private rerankMemories(memories: Memory[]): Memory[] {
    const now = Date.now();

    return memories
      .map(memory => {
        const hoursSinceCreation = (now - memory.metadata.timestamp) / 3600000;
        const recencyScore = Math.pow(0.5, hoursSinceCreation / 24);
        const accessScore = Math.log(memory.metadata.accessCount + 1) / 10;
        const score = recencyScore * 0.3 + memory.metadata.importance * 0.4 + accessScore * 0.3;
        return { memory, score };
      })
      .sort((a, b) => b.score - a.score)
      .map(item => item.memory);
  }

  /**
   * 评估记忆重要性（优先 LLM，fallback 启发式）
   */
  private async evaluateImportance(content: string, context?: string): Promise<number> {
    if (this.evaluator) {
      try {
        const evaluation = await this.evaluator.evaluate(content, context);
        return evaluation.score;
      } catch (error: any) {
        logger.warn(`LLM 评估失败，使用启发式方法: ${error.message}`);
      }
    }

    let importance = 0.5;

    const highImportanceKeywords = [
      '重要', '关键', '务必', '记住', '不要忘记',
      'important', 'remember', 'critical', 'must', 'never forget'
    ];
    if (highImportanceKeywords.some(k => content.toLowerCase().includes(k.toLowerCase()))) {
      importance += 0.3;
    }

    if (content.length > 200) importance += 0.1;
    if (content.includes('?') || content.includes('？')) importance += 0.1;
    if (/\d+/.test(content)) importance += 0.05;

    return Math.min(importance, 1.0);
  }

  /**
   * 清理过期记忆
   */
  private async cleanupOldMemories(): Promise<number> {
    const maxAgeMs = this.maxMemoryAgeDays * 24 * 3600 * 1000;
    const deletedCount = this.db.pruneMemories(maxAgeMs, 0.3, 2);
    if (deletedCount > 0)
      logger.info(`清理了 ${deletedCount} 条过期记忆（超过 ${this.maxMemoryAgeDays} 天）`);
    return deletedCount;
  }

  /**
   * 截断内容用于目录标签
   */
  private truncateContent(content: string, maxLength: number): string {
    const cleaned = content.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= maxLength) return cleaned;
    return cleaned.substring(0, maxLength) + '...';
  }

  /**
   * 格式化时间差
   */
  private formatTimeAgo(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (days > 0) return `${days}天前`;
    if (hours > 0) return `${hours}小时前`;
    if (minutes > 0) return `${minutes}分钟前`;
    return '刚刚';
  }
}
