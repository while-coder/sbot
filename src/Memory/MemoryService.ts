import { v4 as uuidv4 } from "uuid";
import { Embeddings } from "@langchain/core/embeddings";
import { OpenAIEmbeddings } from "@langchain/openai";
import { MemoryDatabase } from "./MemoryDatabase";
import { Memory, MemoryType, MemoryRetrievalOptions, MemoryMetadata } from "./types";
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
}

/**
 * 记忆服务
 * 提供记忆的添加、检索、管理功能
 */
export class MemoryService {
  private db: MemoryDatabase;
  private embeddings: Embeddings;
  private userId: string;
  private sessionId: string;
  private enableAutoCleanup: boolean;
  private maxMemoryAgeDays: number;

  constructor(config: MemoryServiceConfig) {
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

    logger.info(`记忆服务已启动 - 用户: ${this.userId}, 会话: ${this.sessionId}`);

    // 如果启用自动清理，执行一次清理
    if (this.enableAutoCleanup) {
      this.cleanupOldMemories().catch(err => {
        logger.error(`自动清理记忆失败: ${err.message}`);
      });
    }
  }

  /**
   * 添加记忆
   * @param content 记忆内容
   * @param type 记忆类型
   * @param importance 重要性（0-1），如果不提供则自动评估
   * @param additionalMetadata 额外的元数据
   * @returns 记忆ID
   */
  async addMemory(
    content: string,
    type: MemoryType = MemoryType.EPISODIC,
    importance?: number,
    additionalMetadata?: Record<string, any>
  ): Promise<string> {
    try {
      // 生成向量嵌入
      const embedding = await this.embeddings.embedQuery(content);

      // 自动评估重要性（如果未提供）
      const finalImportance = importance ?? this.evaluateImportance(content);

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
   * @param items 记忆项数组
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
      // 批量生成嵌入
      const contents = items.map(item => item.content);
      const embeddings = await this.embeddings.embedDocuments(contents);

      // 创建记忆对象
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
   * 结合向量相似度、时间衰减、访问频率等多种策略
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

      // 生成查询向量
      const queryEmbedding = await this.embeddings.embedQuery(query);

      let results;

      if (keywords.length > 0) {
        // 混合检索：向量 + 关键词 + 时间衰减
        results = this.db.hybridSearch(
          queryEmbedding,
          keywords,
          Date.now(),
          limit * 2,
          type,
          this.userId
        );
      } else if (useTimeDecay) {
        // 时间衰减检索
        results = this.db.searchWithTimeDecay(
          queryEmbedding,
          Date.now(),
          0.995, // 每小时衰减 0.5%
          limit * 2,
          type,
          this.userId
        );
      } else {
        // 纯向量相似度检索
        results = this.db.searchSimilar(
          queryEmbedding,
          limit * 2,
          type,
          minImportance,
          this.userId
        );
      }

      // 更新访问统计
      results.forEach(result => {
        this.db.updateMemoryAccess(result.memory.id);
      });

      // 应用重排序
      const rankedMemories = this.rerankMemories(
        results.map(r => r.memory),
        query
      );

      logger.debug(`检索到 ${rankedMemories.length} 条相关记忆`);

      return rankedMemories.slice(0, limit);
    } catch (error: any) {
      logger.error(`检索记忆失败: ${error.message}`);
      return [];
    }
  }

  /**
   * 记忆重排序
   * 综合考虑：重要性、新鲜度、访问频率
   */
  private rerankMemories(memories: Memory[], query: string): Memory[] {
    const now = Date.now();

    return memories
      .map(memory => {
        // 计算时间衰减因子（24小时为半衰期）
        const hoursSinceCreation = (now - memory.metadata.timestamp) / 3600000;
        const recencyScore = Math.pow(0.5, hoursSinceCreation / 24);

        // 访问频率得分（对数归一化）
        const accessScore = Math.log(memory.metadata.accessCount + 1) / 10;

        // 综合得分
        const score =
          recencyScore * 0.3 +
          memory.metadata.importance * 0.4 +
          accessScore * 0.3;

        return { memory, score };
      })
      .sort((a, b) => b.score - a.score)
      .map(item => item.memory);
  }

  /**
   * 自动评估记忆重要性
   * 使用启发式规则
   */
  private evaluateImportance(content: string): number {
    let importance = 0.5; // 基础分

    // 包含关键词加分
    const highImportanceKeywords = [
      '重要', '关键', '务必', '记住', '不要忘记',
      'important', 'remember', 'critical', 'must', 'never forget'
    ];
    if (highImportanceKeywords.some(k => content.toLowerCase().includes(k.toLowerCase()))) {
      importance += 0.3;
    }

    // 长度影响（较长的内容可能更重要）
    if (content.length > 200) {
      importance += 0.1;
    }

    // 问题或决策类内容
    if (content.includes('?') || content.includes('？')) {
      importance += 0.1;
    }

    // 包含数字或具体数据
    if (/\d+/.test(content)) {
      importance += 0.05;
    }

    return Math.min(importance, 1.0);
  }

  /**
   * 对话历史记忆化
   * 将当前对话存储为情节记忆
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
      {
        userMessage,
        assistantMessage,
        conversationType: 'dialogue'
      }
    );
  }

  /**
   * 提取并存储语义知识
   * 从对话中提取关键事实
   */
  async extractSemanticMemory(
    text: string,
    tags?: string[]
  ): Promise<string> {
    return await this.addMemory(
      text,
      MemoryType.SEMANTIC,
      0.8,
      { tags }
    );
  }

  /**
   * 获取记忆摘要（用于注入到 prompt）
   * @param query 查询内容
   * @param maxTokens 最大 token 数（粗略估算）
   * @returns 格式化的记忆摘要
   */
  async getMemorySummary(
    query: string,
    maxTokens: number = 500
  ): Promise<string> {
    const memories = await this.retrieveRelevantMemories(query, {
      limit: 10,
      useTimeDecay: true
    });

    if (memories.length === 0) {
      return "";
    }

    // 构建摘要
    let summary = "# 相关记忆\n\n";
    let currentTokens = 0;

    for (const memory of memories) {
      const timeAgo = this.formatTimeAgo(memory.metadata.timestamp);
      const memoryText = `- [${memory.type}] (${timeAgo}) ${memory.content}\n`;
      const tokens = memoryText.length / 4; // 粗略估算 token 数

      if (currentTokens + tokens > maxTokens) {
        break;
      }

      summary += memoryText;
      currentTokens += tokens;
    }

    return summary;
  }

  /**
   * 获取完整的记忆上下文（结构化格式）
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
      if (!memory) {
        throw new Error(`记忆 ${memoryId} 不存在`);
      }

      this.db.updateMemory(memoryId, {
        metadata: {
          ...memory.metadata,
          importance
        }
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
   * @param maxAgeDays 最大保留天数
   */
  async cleanupOldMemories(maxAgeDays?: number): Promise<number> {
    const days = maxAgeDays ?? this.maxMemoryAgeDays;
    const maxAgeMs = days * 24 * 3600 * 1000;

    const deletedCount = this.db.pruneMemories(
      maxAgeMs,
      0.3, // 最低重要性阈值
      2    // 最少访问次数
    );

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
   * 释放资源
   */
  dispose(): void {
    this.db.close();
    logger.info(`记忆服务已关闭 - 用户: ${this.userId}`);
  }
}
