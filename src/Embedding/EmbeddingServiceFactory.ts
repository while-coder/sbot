import { IEmbeddingService } from "./IEmbeddingService";
import { OpenAIEmbeddingService } from "./OpenAIEmbeddingService";
import { config } from "../Config";
import { LoggerService } from "../LoggerService";

const logger = LoggerService.getLogger("EmbeddingServiceFactory");

/**
 * Embedding 服务工厂
 *
 * 负责创建和缓存 EmbeddingService 实例，确保相同 embeddingName 返回同一个实例。
 *
 * @example
 * ```ts
 * const embedding1 = await EmbeddingServiceFactory.getEmbeddingService("openai-ada-002");
 * const embedding2 = await EmbeddingServiceFactory.getEmbeddingService("openai-ada-002");
 * // embedding1 === embedding2 (同一个实例)
 * ```
 */
export class EmbeddingServiceFactory {
  private static readonly cache = new Map<string, IEmbeddingService>();

  /**
   * 获取指定 embedding 的服务实例（带缓存）
   * @param embeddingName embedding 名称
   * @returns Embedding 服务实例
   */
  static async getEmbeddingService(embeddingName: string): Promise<IEmbeddingService> {
    // 从缓存中获取
    if (this.cache.has(embeddingName)) {
      logger.debug(`使用缓存的 embedding 服务: ${embeddingName}`);
      return this.cache.get(embeddingName)!;
    }

    // 创建新实例
    logger.debug(`创建新的 embedding 服务: ${embeddingName}`);
    const service = await this.createEmbeddingService(embeddingName);

    // 缓存
    this.cache.set(embeddingName, service);
    return service;
  }

  /**
   * 创建 embedding 服务实例
   */
  private static async createEmbeddingService(embeddingName: string): Promise<IEmbeddingService> {
    const embeddingConfig = config.getEmbedding(embeddingName);
    if (!embeddingConfig) {
      throw new Error(`Embedding 配置 "${embeddingName}" 未找到`);
    }

    // 目前只支持 OpenAI，未来可以根据 provider 字段扩展
    const service = new OpenAIEmbeddingService(embeddingConfig);
    await service.initialize();
    return service;
  }

  /**
   * 清除缓存并释放所有 embedding 服务资源
   */
  static async clearCache(): Promise<void> {
    for (const [embeddingName, service] of this.cache.entries()) {
      try {
        await service.cleanup();
        logger.debug(`已释放 embedding 服务: ${embeddingName}`);
      } catch (error: any) {
        logger.warn(`释放 embedding 服务失败 (${embeddingName}): ${error.message}`);
      }
    }

    this.cache.clear();
    logger.debug("已清除所有 embedding 服务缓存");
  }

  /**
   * 检查是否已缓存
   */
  static hasCached(embeddingName: string): boolean {
    return this.cache.has(embeddingName);
  }

  /**
   * 获取缓存的 embedding 列表
   */
  static getCachedEmbeddings(): string[] {
    return Array.from(this.cache.keys());
  }
}
