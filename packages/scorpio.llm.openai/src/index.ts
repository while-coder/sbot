import {
  EmbeddingProvider,
  type LlmProviderRegistry,
  ModelProvider,
  llmProviderRegistry,
} from "scorpio.llm";
import { OpenAIEmbeddingService } from "./OpenAIEmbeddingService";
import { OpenAIModelService } from "./OpenAIModelService";
import { OpenAIResponseModelService } from "./OpenAIResponseModelService";

export { OpenAIModelService, OpenAIResponseModelService, OpenAIEmbeddingService };

export function registerOpenAIProvider(registry: LlmProviderRegistry = llmProviderRegistry): void {
  registry.registerModel(ModelProvider.OpenAI, config => {
    const service = new OpenAIModelService(config);
    service.initialize();
    return service;
  });
  registry.registerModel(ModelProvider.OpenAIResponse, config => {
    const service = new OpenAIResponseModelService(config);
    service.initialize();
    return service;
  });
  registry.registerEmbedding(EmbeddingProvider.OpenAI, config => {
    const service = new OpenAIEmbeddingService(config);
    service.initialize();
    return service;
  });
}
