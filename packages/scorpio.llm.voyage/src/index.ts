import { EmbeddingProvider, type LlmProviderRegistry, llmProviderRegistry } from "scorpio.llm";
import { VoyageAIEmbeddingService } from "./VoyageAIEmbeddingService";

export { VoyageAIEmbeddingService };

export function registerVoyageProvider(registry: LlmProviderRegistry = llmProviderRegistry): void {
  registry.registerEmbedding(EmbeddingProvider.VoyageAI, config => {
    const service = new VoyageAIEmbeddingService(config);
    service.initialize();
    return service;
  });
}
