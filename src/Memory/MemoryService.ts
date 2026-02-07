import { v4 as uuidv4 } from "uuid";
import { Embeddings } from "@langchain/core/embeddings";
import { OpenAIEmbeddings } from "@langchain/openai";
import { Container } from "../Core";
import { MemoryDatabase } from "./MemoryDatabase";
import { Memory, MemoryType, MemoryRetrievalOptions, MemoryMetadata } from "./types";
import { ImportanceEvaluator, ImportanceEvaluation } from "./ImportanceEvaluator";
import { MemoryCompressor, MergeStrategy, CompressionResult } from "./MemoryCompressor";
import { LoggerService } from "../LoggerService";

const logger = LoggerService.getLogger("MemoryService.ts");

/**
 * 记忆服务配置
 */
export interface MemoryServiceConfig {
  userId: string;
  dbPath: string;
  embeddingConfig?: {
    apiKey: string;
    baseURL?: string;
    model?: string;
  };
  enableAutoCleanup?: boolean;
  maxMemoryAgeDays?: number;
  compressionModel?: string;           // 压缩使用的模型
}

/**
 * 记忆服务
 * 提供记忆的添加、检索、管理功能
 *
 * 内部使用 DI 容器管理子服务（ImportanceEvaluator、MemoryCompressor），
 * 子服务通过 tryResolve 按需获取，容器中注册了配置即启用。
 *
 * @example
 * ```ts
 * const memoryService = new MemoryService({
 *   userId: "user1",
 *   dbPath: "./memory.db",
 *   embeddingConfig: { apiKey: "xxx", baseURL: "https://api.openai.com" },
 * });
 *
 * // 子服务通过 tryResolve 按需获取，有注册即启用，无注册即禁用
 * const evaluator = await memoryService.getService(ImportanceEvaluator);
 * const compressor = await memoryService.getService(MemoryCompressor);
 * ```
 */
export class MemoryService {
  private db: MemoryDatabase;
  private embeddings: Embeddings;
  private userId: string;
  private sessionId: string;
  private enableAutoCleanup: boolean;
  private maxMemoryAgeDays: number;
  private config: MemoryServiceConfig;

  /**
   * 内部 DI 容器，管理 ImportanceEvaluator 和 MemoryCompressor 等子服务
   */
  readonly container: Container;

  constructor(config: MemoryServiceConfig) {
    this.config = config;
    this.userId = config.userId;
    this.sessionId = uuidv4();
    this.db = new MemoryDatabase(config.dbPath);
    this.enableAutoCleanup = config.enableAutoCleanup ?? false;
    this.maxMemoryAgeDays = config.maxMemoryAgeDays ?? 90;

    // 初始化 embedding 模型
    if (config.embeddingConfig) {
      this.embeddings = new OpenAIEmbeddings({
        modelName: config.embeddingConfig.model || "text-embedding-ada-002",
        openAIApiKey: config.embeddingConfig.apiKey,
        configuration: {
          baseURL: config.embeddingConfig.baseURL
        }
      });
    } else {
      throw new Error("必须提供 embeddingConfig 配置");
    }

    // 创建内部 DI 容器
    this.container = new Container();
    this.registerServices();

    logger.info(`记忆服务已创建 - 用户: ${this.userId}, 会话: ${this.sessionId}`);
  }

  /**
   * 初始化服务
   */
  async init(): Promise<void> {
    logger.info(`记忆服务已初始化 - 用户: ${this.userId}`);

    // 如果启用自动清理，执行一次清理
    if (this.enableAutoCleanup) {
      this.cleanupOldMemories().catch(err => {
        logger.error(`自动清理记忆失败: ${err.message}`);
      });
    }
  }

  /**
   * 注册子服务到内部容器
   */
  private registerServices(): void {
    const embeddingConfig = this.config.embeddingConfig!;
    const model = this.config.compressionModel || "gpt-3.5-turbo";

    // 注册 ImportanceEvaluator 配置
    this.container.registerInstance("ImportanceEvaluatorConfig", {
      apiKey: embeddingConfig.apiKey,
      baseURL: embeddingConfig.baseURL,
      model,
    });

    // 注册 MemoryCompressor 配置
    this.container.registerInstance("MemoryCompressorConfig", {
      apiKey: embeddingConfig.apiKey,
      baseURL: embeddingConfig.baseURL,
      model,
    });
  }

  /**
   * 从内部容器获取子服务
   *
   * @example
   * ```ts
   * const evaluator = await memoryService.getService(ImportanceEvaluator);
   * if (evaluator) {
   *   const result = await evaluator.evaluate("some text");
   * }
   * ```
   */
  async getService<T>(token: new (...args: any[]) => T): Promise<T | null> {
    return await this.container.tryResolve<T>(token);
  }

  /**
   * 添加记忆
   */
  async addMemory(
    content: string,
    type: MemoryType = MemoryType.EPISODIC,
    importance?: number,
    additionalMetadata?: Record<string, any>,
    useLLMEvaluation: boolean = true
  ): Promise<string> {
    try {
      const embedding = await this.embeddings.embedQuery(content);

      let finalImportance: number;
      if (importance !== undefined) {
        finalImportance = importance;
      } else if (useLLMEvaluation) {
        finalImportance = await this.evaluateImportanceAsync(content);
      } else {
        finalImportance = this.evaluateImportance(content);
      }

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
      logger.debug(`添加记忆成功 - ID: ${memory.id}, 类型: ${type}, 重要性: ${finalImportance.toFixed(2)}`);

      return memory.id;
    } catch (error: any) {
      logger.error(`添加记忆失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 批量添加记忆
   */
  async batchAddMemories(
    items: Array<{
      content: string;
      type?: MemoryType;
      importance?: number;
      metadata?: Record<string, any>;
    }>
  ): Promise<string[]> {
    try {
      const contents = items.map(item => item.content);
      const embeddings = await this.embeddings.embedDocuments(contents);

      const memories: Memory[] = items.map((item, index) => ({
        id: uuidv4(),
        type: item.type || MemoryType.EPISODIC,
        content: item.content,
        embedding: embeddings[index],
        metadata: {
          timestamp: Date.now(),
          userId: this.userId,
          sessionId: this.sessionId,
          importance: item.importance ?? this.evaluateImportance(item.content),
          accessCount: 0,
          lastAccessed: Date.now(),
          ...item.metadata
        }
      }));

      this.db.batchInsertMemories(memories);
      logger.info(`批量添加 ${memories.length} 条记忆`);

      return memories.map(m => m.id);
    } catch (error: any) {
      logger.error(`批量添加记忆失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 智能记忆检索
   */
  async retrieveRelevantMemories(
    query: string,
    options: MemoryRetrievalOptions = {}
  ): Promise<Memory[]> {
    try {
      const {
        limit = 5,
        type,
        useTimeDecay = true,
        minImportance = 0,
        keywords = []
      } = options;

      const queryEmbedding = await this.embeddings.embedQuery(query);

      let results;

      if (keywords.length > 0) {
        results = this.db.hybridSearch(
          queryEmbedding, keywords, Date.now(), limit * 2, type, this.userId
        );
      } else if (useTimeDecay) {
        results = this.db.searchWithTimeDecay(
          queryEmbedding, Date.now(), 0.995, limit * 2, type, this.userId
        );
      } else {
        results = this.db.searchSimilar(
          queryEmbedding, limit * 2, type, minImportance, this.userId
        );
      }

      results.forEach(result => {
        this.db.updateMemoryAccess(result.memory.id);
      });

      const rankedMemories = this.rerankMemories(results.map(r => r.memory), query);

      logger.debug(`检索到 ${rankedMemories.length} 条相关记忆`);
      return rankedMemories.slice(0, limit);
    } catch (error: any) {
      logger.error(`检索记忆失败: ${error.message}`);
      return [];
    }
  }

  /**
   * 记忆重排序
   */
  private rerankMemories(memories: Memory[], query: string): Memory[] {
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
   * 自动评估记忆重要性（优先使用 LLM）
   */
  private async evaluateImportanceAsync(content: string, context?: string): Promise<number> {
    const evaluator = await this.container.tryResolve(ImportanceEvaluator);
    if (evaluator) {
      try {
        const evaluation = await evaluator.evaluate(content, context);
        logger.debug(`LLM 评估重要性: ${evaluation.score.toFixed(2)} - ${evaluation.reasoning}`);
        return evaluation.score;
      } catch (error: any) {
        logger.warn(`LLM 评估失败，使用启发式方法: ${error.message}`);
      }
    }
    return this.evaluateImportance(content);
  }

  /**
   * 启发式重要性评估（备用方案）
   */
  private evaluateImportance(content: string): number {
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
   * 对话历史记忆化
   */
  async memorizeConversation(
    userMessage: string,
    assistantMessage: string,
    importance?: number
  ): Promise<void> {
    const conversationText = `User: ${userMessage}\nAssistant: ${assistantMessage}`;
    await this.addMemory(
      conversationText,
      MemoryType.EPISODIC,
      importance,
      { userMessage, assistantMessage, conversationType: 'dialogue' }
    );
  }

  /**
   * 提取并存储语义知识
   */
  async extractSemanticMemory(text: string, tags?: string[]): Promise<string> {
    return await this.addMemory(text, MemoryType.SEMANTIC, 0.8, { tags });
  }

  /**
   * 获取记忆摘要（用于注入到 prompt）
   */
  async getMemorySummary(query: string, maxTokens: number = 500): Promise<string> {
    const memories = await this.retrieveRelevantMemories(query, {
      limit: 10,
      useTimeDecay: true
    });

    if (memories.length === 0) return "";

    let summary = "# 相关记忆\n\n";
    let currentTokens = 0;

    for (const memory of memories) {
      const timeAgo = this.formatTimeAgo(memory.metadata.timestamp);
      const memoryText = `- [${memory.type}] (${timeAgo}) ${memory.content}\n`;
      const tokens = memoryText.length / 4;

      if (currentTokens + tokens > maxTokens) break;

      summary += memoryText;
      currentTokens += tokens;
    }

    return summary;
  }

  /**
   * 获取完整的记忆上下文
   */
  async getMemoryContext(query: string, limit: number = 5): Promise<Array<{
    content: string;
    type: MemoryType;
    importance: number;
    timeAgo: string;
  }>> {
    const memories = await this.retrieveRelevantMemories(query, { limit });
    return memories.map(memory => ({
      content: memory.content,
      type: memory.type,
      importance: memory.metadata.importance,
      timeAgo: this.formatTimeAgo(memory.metadata.timestamp)
    }));
  }

  /**
   * 更新记忆重要性
   */
  async updateMemoryImportance(memoryId: string, importance: number): Promise<void> {
    try {
      const memory = this.db.getMemoryById(memoryId);
      if (!memory) throw new Error(`记忆 ${memoryId} 不存在`);

      this.db.updateMemory(memoryId, {
        metadata: { ...memory.metadata, importance }
      });
      logger.debug(`更新记忆 ${memoryId} 的重要性为 ${importance}`);
    } catch (error: any) {
      logger.error(`更新记忆重要性失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 删除记忆
   */
  deleteMemory(memoryId: string): void {
    this.db.deleteMemory(memoryId);
    logger.info(`删除记忆: ${memoryId}`);
  }

  /**
   * 清理过期记忆
   */
  async cleanupOldMemories(maxAgeDays?: number): Promise<number> {
    const days = maxAgeDays ?? this.maxMemoryAgeDays;
    const maxAgeMs = days * 24 * 3600 * 1000;
    const deletedCount = this.db.pruneMemories(maxAgeMs, 0.3, 2);
    logger.info(`清理了 ${deletedCount} 条过期记忆（超过 ${days} 天）`);
    return deletedCount;
  }

  /**
   * 清空所有记忆
   */
  clearAllMemories(): number {
    const count = this.db.clearUserMemories(this.userId);
    logger.info(`清空用户 ${this.userId} 的所有记忆`);
    return count;
  }

  /**
   * 获取记忆统计信息
   */
  getStatistics() {
    return this.db.getStatistics(this.userId);
  }

  /**
   * 优化数据库
   */
  optimize(): void {
    this.db.vacuum();
  }

  /**
   * 使用 LLM 评估记忆重要性
   */
  async evaluateMemoryImportanceWithLLM(memoryId: string): Promise<ImportanceEvaluation | null> {
    const evaluator = await this.container.tryResolve(ImportanceEvaluator);
    if (!evaluator) {
      logger.warn("LLM 重要性评估未启用");
      return null;
    }

    const memory = this.db.getMemoryById(memoryId);
    if (!memory) {
      logger.warn(`记忆 ${memoryId} 不存在`);
      return null;
    }

    try {
      const evaluation = await evaluator.evaluate(memory.content);
      await this.updateMemoryImportance(memoryId, evaluation.score);

      if (evaluation.tags && evaluation.tags.length > 0) {
        this.db.updateMemory(memoryId, {
          metadata: {
            ...memory.metadata,
            importance: evaluation.score,
            tags: evaluation.tags,
            category: evaluation.category
          }
        });
      }

      logger.info(`重新评估记忆 ${memoryId} 的重要性: ${evaluation.score.toFixed(2)}`);
      return evaluation;
    } catch (error: any) {
      logger.error(`评估记忆重要性失败: ${error.message}`);
      return null;
    }
  }

  /**
   * 压缩相似的记忆
   */
  async compressSimilarMemories(
    similarityThreshold: number = 0.8,
    strategy: MergeStrategy = MergeStrategy.CHRONOLOGICAL
  ): Promise<CompressionResult[]> {
    const compressor = await this.container.tryResolve(MemoryCompressor);
    if (!compressor) {
      logger.warn("记忆压缩功能未启用");
      return [];
    }

    try {
      const stats = this.db.getStatistics(this.userId);
      if (stats.totalCount < 2) {
        logger.info("记忆数量不足，无需压缩");
        return [];
      }

      logger.info("正在查找可压缩的记忆组...");
      logger.warn("压缩功能需要先实现获取所有记忆的方法");
      return [];
    } catch (error: any) {
      logger.error(`压缩记忆失败: ${error.message}`);
      return [];
    }
  }

  /**
   * 按时间窗口压缩记忆
   */
  async compressMemoriesByTimeWindow(
    timeWindowMs: number = 7 * 24 * 3600 * 1000,
    minGroupSize: number = 3,
    strategy: MergeStrategy = MergeStrategy.CHRONOLOGICAL
  ): Promise<number> {
    const compressor = await this.container.tryResolve(MemoryCompressor);
    if (!compressor) {
      logger.warn("记忆压缩功能未启用");
      return 0;
    }

    logger.info(`开始按时间窗口压缩记忆（窗口: ${timeWindowMs}ms, 最小组: ${minGroupSize}）`);
    logger.warn("此功能需要进一步实现");
    return 0;
  }

  /**
   * 手动压缩指定的记忆
   */
  async compressSpecificMemories(
    memoryIds: string[],
    strategy: MergeStrategy = MergeStrategy.THEMATIC
  ): Promise<CompressionResult | null> {
    const compressor = await this.container.tryResolve(MemoryCompressor);
    if (!compressor) {
      logger.warn("记忆压缩功能未启用");
      return null;
    }

    if (memoryIds.length < 2) {
      logger.warn("至少需要2条记忆才能压缩");
      return null;
    }

    try {
      const memories: Memory[] = [];
      for (const id of memoryIds) {
        const memory = this.db.getMemoryById(id);
        if (memory) memories.push(memory);
      }

      if (memories.length < 2) {
        logger.warn("有效记忆数量不足");
        return null;
      }

      const result = await compressor.compress(
        memories,
        strategy,
        (text: string) => this.embeddings.embedQuery(text)
      );

      if (result) {
        this.db.insertMemory(result.compressedMemory);
        for (const id of result.sourceMemoryIds) {
          this.db.deleteMemory(id);
        }
        logger.info(`成功压缩 ${result.sourceMemoryIds.length} 条记忆，压缩比: ${(result.compressionRatio * 100).toFixed(1)}%`);
      }

      return result;
    } catch (error: any) {
      logger.error(`压缩指定记忆失败: ${error.message}`);
      return null;
    }
  }

  /**
   * 获取重要性评估器
   */
  async getImportanceEvaluator(): Promise<ImportanceEvaluator | null> {
    return await this.container.tryResolve(ImportanceEvaluator);
  }

  /**
   * 获取记忆压缩器
   */
  async getCompressor(): Promise<MemoryCompressor | null> {
    return await this.container.tryResolve(MemoryCompressor);
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

  /**
   * 释放资源（同时销毁内部容器）
   */
  async dispose(): Promise<void> {
    await this.container.dispose();
    this.db.close();
    logger.info(`记忆服务已关闭 - 用户: ${this.userId}`);
  }
}
