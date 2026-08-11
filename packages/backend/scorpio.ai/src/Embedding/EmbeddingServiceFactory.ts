import { type EmbeddingConfig, type IEmbeddingService, llmProviderRegistry } from "scorpio.llm";

export class EmbeddingServiceFactory {
  static getEmbeddingService(config: EmbeddingConfig): IEmbeddingService {
    return llmProviderRegistry.createEmbedding(config);
  }
}
