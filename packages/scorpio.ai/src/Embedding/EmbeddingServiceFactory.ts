import { IEmbeddingService } from "./IEmbeddingService";
import { OpenAIEmbeddingService } from "./OpenAIEmbeddingService";
import { EmbeddingConfig, EmbeddingProvider } from "./types";

/**
 * Embedding 服务工厂
 *
 * 根据 EmbeddingConfig 创建对应的 EmbeddingService 实例。
 *
 * @example
 * ```ts
 * const service = await EmbeddingServiceFactory.getEmbeddingService({ provider: EmbeddingProvider.OpenAI, model: "text-embedding-ada-002", apiKey: "sk-..." });
 * ```
 */
export class EmbeddingServiceFactory {
  /**
   * 创建指定 embedding 的服务实例
   * @param config Embedding 配置
   * @returns Embedding 服务实例
   */
  static async getEmbeddingService(config: EmbeddingConfig): Promise<IEmbeddingService> {
    switch (config.provider) {
      case EmbeddingProvider.OpenAI:
        const service = new OpenAIEmbeddingService(config);
        await service.initialize();
        return service;
      default:
        throw new Error(`不支持的 Embedding 提供者: ${config.provider}`);
    }
  }
}
