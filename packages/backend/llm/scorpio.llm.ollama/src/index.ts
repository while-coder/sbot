import {
  ApiKeyMode,
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
    apiKeyMode: ApiKeyMode.Disabled,
    createModel: config => {
      const service = new OllamaModelService(config);
      service.initialize();
      return service;
    },
  });
  registry.registerEmbedding({
    type: EmbeddingProvider.Ollama,
    label: "Ollama",
    configSchema: {
      dimensions: {
        label: "向量维度",
        type: "number",
        description: "指定模型输出的向量维度",
      },
      keepAlive: {
        label: "保持加载时间",
        type: "string",
        description: "例如 5m；控制模型在内存中保持加载的时间",
      },
      truncate: {
        label: "自动截断",
        type: "boolean",
        default: false,
        description: "输入超出模型上下文时自动截断",
      },
    },
    defaults: {
      baseURL: "http://localhost:11434",
      model: "nomic-embed-text",
      config: { truncate: false },
    },
    apiKeyMode: ApiKeyMode.Disabled,
    createEmbedding: config => {
      const service = new OllamaEmbeddingService(config);
      service.initialize();
      return service;
    },
  });
}
