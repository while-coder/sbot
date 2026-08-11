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
  registry.registerModel({
    type: ModelProvider.Ollama,
    label: "Ollama",
    configSchema: {},
    defaults: { baseURL: "http://localhost:11434" },
    apiKeyEnabled: false,
    apiKeyRequired: false,
    createModel: config => {
      const service = new OllamaModelService(config);
      service.initialize();
      return service;
    },
    listModels: async config => {
      if (!config.baseURL) throw new Error("baseURL is required");
      const res = await fetch(`${config.baseURL.replace(/\/$/, "")}/api/tags`);
      if (!res.ok) throw new Error(`Ollama request failed: ${res.status}`);
      const data: any = await res.json();
      return (data.models || []).map((model: any) => model.name as string);
    },
  });
  registry.registerEmbedding(EmbeddingProvider.Ollama, config => {
    const service = new OllamaEmbeddingService(config);
    service.initialize();
    return service;
  });
}
