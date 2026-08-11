import { EmbeddingProvider, type LlmProviderRegistry, llmProviderRegistry } from "scorpio.llm";
import { CohereEmbeddingService } from "./CohereEmbeddingService";

export { CohereEmbeddingService };

export function registerCohereProvider(registry: LlmProviderRegistry = llmProviderRegistry): void {
  registry.registerEmbedding(EmbeddingProvider.Cohere, config => {
    const service = new CohereEmbeddingService(config);
    service.initialize();
    return service;
  });
}
