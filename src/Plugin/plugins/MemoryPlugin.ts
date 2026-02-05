import { BasePlugin, PluginMetadata, PluginContext } from "../IPlugin";
import { MemoryService, MemoryServiceConfig } from "../../Memory/MemoryService";
import { MemoryType } from "../../Memory/types";
import { AgentMessage } from "../../Agent/AgentService";
import { v4 as uuidv4 } from "uuid";

/**
 * 记忆插件配置
 */
export interface MemoryPluginConfig {
  dbPath: string;
  embeddingConfig: {
    apiKey: string;
    baseURL?: string;
    model?: string;
  };
  enableAutoCleanup?: boolean;
  maxMemoryAgeDays?: number;
  enableLLMEvaluation?: boolean;
  enableCompression?: boolean;
  compressionModel?: string;
  autoMemorize?: boolean;              // 是否自动记忆对话
  memorizeThreshold?: number;          // 自动记忆的重要性阈值
  autoRetrieve?: boolean;              // 是否自动检索相关记忆
  retrievalLimit?: number;             // 检索记忆的数量限制
}

/**
 * 记忆插件
 * 为 Agent 提供长期记忆功能
 */
export class MemoryPlugin extends BasePlugin {
  metadata: PluginMetadata = {
    name: "MemoryPlugin",
    version: "1.0.0",
    description: "长期记忆插件，支持语义检索、重要性评估和记忆压缩",
    author: "SBot Team",
    homepage: "https://github.com/your-repo"
  };

  private memoryService?: MemoryService;
  private userId?: string;
  private autoMemorize: boolean = true;
  private memorizeThreshold: number = 0.5;
  private autoRetrieve: boolean = true;
  private retrievalLimit: number = 5;

  async onLoad(context: PluginContext): Promise<void> {
    await super.onLoad(context);

    const config = context.config as MemoryPluginConfig;

    // 验证必需配置
    if (!config.dbPath || !config.embeddingConfig) {
      throw new Error("MemoryPlugin 需要 dbPath 和 embeddingConfig 配置");
    }

    // 设置选项
    this.autoMemorize = config.autoMemorize ?? true;
    this.memorizeThreshold = config.memorizeThreshold ?? 0.5;
    this.autoRetrieve = config.autoRetrieve ?? true;
    this.retrievalLimit = config.retrievalLimit ?? 5;

    // 初始化记忆服务（使用默认用户ID）
    this.userId = "default-user";
    await this.initializeMemoryService(this.userId, config);

    // 监听用户切换事件
    this.on("user:changed", async (data: { userId: string }) => {
      this.context?.logger.info(`用户切换到: ${data.userId}`);
      this.userId = data.userId;
      await this.initializeMemoryService(data.userId, config);
    });

    this.context?.logger.info(`MemoryPlugin 已加载 - 自动记忆: ${this.autoMemorize}, 自动检索: ${this.autoRetrieve}`);
  }

  async onUnload(): Promise<void> {
    // 清理资源
    this.memoryService = undefined;
    this.userId = undefined;
    await super.onUnload();
  }

  /**
   * 初始化或重新初始化记忆服务
   */
  private async initializeMemoryService(userId: string, config: MemoryPluginConfig): Promise<void> {
    const memoryConfig: MemoryServiceConfig = {
      userId,
      dbPath: config.dbPath,
      embeddingConfig: config.embeddingConfig,
      enableAutoCleanup: config.enableAutoCleanup,
      maxMemoryAgeDays: config.maxMemoryAgeDays,
      enableLLMEvaluation: config.enableLLMEvaluation,
      enableCompression: config.enableCompression,
      compressionModel: config.compressionModel
    };

    this.memoryService = new MemoryService(memoryConfig);
    this.context?.logger.info(`记忆服务已初始化 - 用户: ${userId}`);
  }

  /**
   * 查询前钩子 - 检索相关记忆并注入上下文
   */
  async onBeforeQuery(query: string, context: any): Promise<string> {
    if (!this.autoRetrieve || !this.memoryService) {
      return query;
    }

    try {
      // 检索相关记忆
      const memories = await this.memoryService.retrieveRelevantMemories(query, {
        limit: this.retrievalLimit,
        minImportance: 0.3
      });

      if (memories.length > 0) {
        this.context?.logger.debug(`检索到 ${memories.length} 条相关记忆`);

        // 构建记忆上下文
        const memoryContext = memories
          .map((mem: any, idx: number) => `[记忆${idx + 1}] ${mem.content}`)
          .join("\n");

        // 将记忆注入到查询中
        const enhancedQuery = `相关记忆：\n${memoryContext}\n\n用户查询：${query}`;

        // 发送事件通知
        this.emit("memory:retrieved", { query, count: memories.length, memories });

        return enhancedQuery;
      }
    } catch (error: any) {
      this.context?.logger.error(`检索记忆失败: ${error.message}`);
    }

    return query;
  }

  /**
   * 响应后钩子 - 记忆重要对话
   */
  async onAfterResponse(response: string, query: string, context: any): Promise<string> {
    if (!this.autoMemorize || !this.memoryService) {
      return response;
    }

    try {
      // 记忆用户查询
      const queryImportance = await this.memoryService.addMemory(
        query,
        MemoryType.EPISODIC,
        undefined,
        { role: "user", conversationId: context?.conversationId },
        true // 使用 LLM 评估
      );

      // 记忆 AI 响应
      const responseImportance = await this.memoryService.addMemory(
        response,
        MemoryType.EPISODIC,
        undefined,
        { role: "assistant", conversationId: context?.conversationId },
        true // 使用 LLM 评估
      );

      this.context?.logger.debug(`对话已记忆 - 查询ID: ${queryImportance}, 响应ID: ${responseImportance}`);

      // 发送事件通知
      this.emit("memory:added", {
        query: { id: queryImportance, content: query },
        response: { id: responseImportance, content: response }
      });

    } catch (error: any) {
      this.context?.logger.error(`记忆对话失败: ${error.message}`);
    }

    return response;
  }

  /**
   * 消息钩子 - 处理记忆相关的特殊消息
   */
  async onMessage(message: AgentMessage, context: any): Promise<AgentMessage> {
    // 检测是否是记忆查询指令
    if (message.content && message.content.startsWith("/memory")) {
      const command = message.content.trim();

      if (command === "/memory stats") {
        // 获取记忆统计
        const stats = await this.getMemoryStats();
        message.content = `记忆统计：\n${JSON.stringify(stats, null, 2)}`;
      } else if (command.startsWith("/memory search ")) {
        // 搜索记忆
        const searchQuery = command.replace("/memory search ", "");
        const results = await this.searchMemories(searchQuery);
        message.content = `搜索结果：\n${results}`;
      } else if (command === "/memory compress") {
        // 压缩记忆
        const result = await this.compressMemories();
        message.content = `压缩完成：\n${result}`;
      }
    }

    return message;
  }

  /**
   * 错误处理钩子
   */
  async onError(error: Error, context: any): Promise<void> {
    this.context?.logger.error(`MemoryPlugin 错误: ${error.message}`);

    // 发送错误事件
    this.emit("memory:error", { error, context });
  }

  /**
   * 获取记忆统计
   */
  private async getMemoryStats(): Promise<any> {
    if (!this.memoryService) {
      return { error: "记忆服务未初始化" };
    }

    try {
      return await this.memoryService.getStatistics();
    } catch (error: any) {
      return { error: error.message };
    }
  }

  /**
   * 搜索记忆
   */
  private async searchMemories(query: string): Promise<string> {
    if (!this.memoryService) {
      return "记忆服务未初始化";
    }

    try {
      const memories = await this.memoryService.retrieveRelevantMemories(query, {
        limit: 10,
        minImportance: 0.2
      });

      if (memories.length === 0) {
        return "未找到相关记忆";
      }

      return memories
        .map((mem: any, idx: number) => {
          const timestamp = new Date(mem.metadata.timestamp).toLocaleString();
          return `${idx + 1}. [${timestamp}] ${mem.content.substring(0, 100)}${mem.content.length > 100 ? "..." : ""}`;
        })
        .join("\n\n");
    } catch (error: any) {
      return `搜索失败: ${error.message}`;
    }
  }

  /**
   * 压缩记忆
   */
  private async compressMemories(): Promise<string> {
    if (!this.memoryService) {
      return "记忆服务未初始化";
    }

    try {
      // 使用相似度压缩
      const results = await this.memoryService.compressSimilarMemories(0.8);

      if (results.length > 0) {
        const totalOriginal = results.reduce((sum: number, r: any) => sum + r.originalMemories.length, 0);
        return `压缩成功：\n- 压缩组数: ${results.length}\n- 原始记忆: ${totalOriginal} 条\n- 压缩后: ${results.length} 条`;
      } else {
        return "没有找到可压缩的记忆";
      }
    } catch (error: any) {
      return `压缩失败: ${error.message}`;
    }
  }

  /**
   * 公开 API：手动添加记忆
   */
  async addMemory(
    content: string,
    type: MemoryType = MemoryType.EPISODIC,
    importance?: number,
    metadata?: Record<string, any>
  ): Promise<string> {
    if (!this.memoryService) {
      throw new Error("记忆服务未初始化");
    }

    return await this.memoryService.addMemory(content, type, importance, metadata);
  }

  /**
   * 公开 API：检索记忆
   */
  async retrieveMemories(query: string, limit: number = 5): Promise<any[]> {
    if (!this.memoryService) {
      throw new Error("记忆服务未初始化");
    }

    return await this.memoryService.retrieveRelevantMemories(query, { limit });
  }

  /**
   * 公开 API：获取记忆统计
   */
  async getStatistics(): Promise<any> {
    if (!this.memoryService) {
      throw new Error("记忆服务未初始化");
    }

    return await this.memoryService.getStatistics();
  }

  /**
   * 公开 API：清理旧记忆
   */
  async cleanupOldMemories(maxAgeDays?: number): Promise<number> {
    if (!this.memoryService) {
      throw new Error("记忆服务未初始化");
    }

    return await this.memoryService.cleanupOldMemories(maxAgeDays);
  }
}
