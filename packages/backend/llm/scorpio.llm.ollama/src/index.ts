import {
  ApiKeyMode,
  type LlmProviderRegistry,
  ModelProvider,
  llmProviderRegistry,
} from "scorpio.llm";
import { OllamaModelService } from "./OllamaModelService";

export { OllamaModelService };

export function registerOllamaProvider(registry: LlmProviderRegistry = llmProviderRegistry): void {
  registry.registerModel({
    type: ModelProvider.Ollama,
    label: "Ollama",
    configSchema: {},
    defaults: { baseURL: "http://localhost:11434" },
    apiKeyMode: ApiKeyMode.Disabled,
    createModel: config => {
      const service = new OllamaModelService(config);
      service.initialize();
      return service;
    },
  });
}
