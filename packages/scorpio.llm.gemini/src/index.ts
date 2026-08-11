import {
  EmbeddingProvider,
  type LlmProviderRegistry,
  ModelProvider,
  llmProviderRegistry,
} from "scorpio.llm";
import { GeminiImageModelService } from "./GeminiImageModelService";
import { GeminiModelService } from "./GeminiModelService";
import { GoogleEmbeddingService } from "./GoogleEmbeddingService";

export { GeminiModelService, GeminiImageModelService, GoogleEmbeddingService };

export function registerGeminiProvider(registry: LlmProviderRegistry = llmProviderRegistry): void {
  registry.registerModel(ModelProvider.Gemini, config => {
    const service = new GeminiModelService(config);
    service.initialize();
    return service;
  });
  registry.registerModel(ModelProvider.GeminiImage, config => {
    const service = new GeminiImageModelService(config);
    service.initialize();
    return service;
  });
  registry.registerEmbedding(EmbeddingProvider.Gemini, config => {
    const service = new GoogleEmbeddingService(config);
    service.initialize();
    return service;
  });
}
