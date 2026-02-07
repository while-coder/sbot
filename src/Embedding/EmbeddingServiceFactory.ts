import { IEmbeddingService } from "./IEmbeddingService";
import { OpenAIEmbeddingService } from "./OpenAIEmbeddingService";
import { EmbeddingConfig } from "../Config";
import { LoggerService } from "../LoggerService";

const logger = LoggerService.getLogger("EmbeddingServiceFactory");

/**
 * Embedding 服务工厂
 *
 * 负责创建和缓存 EmbeddingService 实例，确保相同配置返回同一个实例。
 *
 * @example
 * ```ts
 * const embedding = await EmbeddingServiceFactory.getEmbeddingService({
 *   apiKey: "sk-xxx",
 *   baseURL: "https://api.openai.com/v1",
 *   model: "text-embedding-ada-002"
 * });
 * ```
 */
export class EmbeddingServiceFactory {
  private static readonly cache = new Map<string, IEmbeddingService>();

  /**
   * 获取 embedding 服务实例（带缓存）
   * @param config Embedding 配置
   * @returns Embedding 服务实例
   */
  static async getEmbeddingService(config: EmbeddingConfig): Promise<IEmbeddingService> {
    const cacheKey = this.getCacheKey(config);

    // 从缓存中获取
    if (this.cache.has(cacheKey)) {
      logger.debug(`使用缓存的 embedding 服务: ${config.model || "text-embedding-ada-002"}`);
      return this.cache.get(cacheKey)!;
    }

    // 创建新实例
    logger.debug(`创建新的 embedding 服务: ${config.model || "text-embedding-ada-002"}`);
    const service = await this.createEmbeddingService(config);

    // 缓存
    this.cache.set(cacheKey, service);
    return service;
  }

  /**
   * 创建 embedding 服务实例
   */
  private static async createEmbeddingService(config: EmbeddingConfig): Promise<IEmbeddingService> {
    // 目前只支持 OpenAI，未来可以根据 provider 字段扩展
    const service = new OpenAIEmbeddingService(config);
    await service.initialize();
    return service;
  }

  /**
   * 生成缓存键
   */
  private static getCacheKey(config: EmbeddingConfig): string {
    return `${config.baseURL || "default"}:${config.model || "text-embedding-ada-002"}`;
  }

  /**
   * 清除缓存并释放所有 embedding 服务资源
   */
  static async clearCache(): Promise<void> {
    for (const [key, service] of this.cache.entries()) {
      try {
        await service.cleanup();
        logger.debug(`已释放 embedding 服务: ${key}`);
      } catch (error: any) {
        logger.warn(`释放 embedding 服务失败 (${key}): ${error.message}`);
      }
    }

    this.cache.clear();
    logger.debug("已清除所有 embedding 服务缓存");
  }

  /**
   * 检查是否已缓存
   */
  static hasCached(config: EmbeddingConfig): boolean {
    return this.cache.has(this.getCacheKey(config));
  }

  /**
   * 获取缓存的服务数量
   */
  static getCacheSize(): number {
    return this.cache.size;
  }
}
