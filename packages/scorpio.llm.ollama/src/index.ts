import {
  EmbeddingProvider,
  type LlmProviderRegistry,
  ModelProvider,
  llmProviderRegistry,
} from "scorpio.llm";
import { OllamaEmbeddingService } from "./OllamaEmbeddingService";
import { OllamaModelService } from "./OllamaModelService";

export { OllamaModelService, OllamaEmbeddingService };

export function registerOllamaProvider(registry: LlmProviderRegistry = llmProviderRegistry): void {
  registry.registerModel(ModelProvider.Ollama, config => {
    const service = new OllamaModelService(config);
    service.initialize();
    return service;
  });
  registry.registerEmbedding(EmbeddingProvider.Ollama, config => {
    const service = new OllamaEmbeddingService(config);
    service.initialize();
    return service;
  });
}
