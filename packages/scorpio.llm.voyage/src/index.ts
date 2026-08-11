import { EmbeddingProvider, type LlmProviderRegistry, llmProviderRegistry } from "scorpio.llm";
import { VoyageAIEmbeddingService } from "./VoyageAIEmbeddingService";

export { VoyageAIEmbeddingService };

export function registerVoyageProvider(registry: LlmProviderRegistry = llmProviderRegistry): void {
  registry.registerEmbedding({
    type: EmbeddingProvider.VoyageAI,
    label: "Voyage AI",
    configSchema: {
      batchSize: {
        label: "批处理数量",
        type: "number",
        description: "单次请求包含的最大文档数量",
      },
      stripNewLines: {
        label: "移除换行",
        type: "boolean",
        default: true,
        description: "向量化前移除文本中的换行符",
      },
    },
    defaults: {
      baseURL: "https://api.voyageai.com/v1",
      model: "voyage-3",
      config: { stripNewLines: true },
    },
    apiKeyRequired: true,
    createEmbedding: config => {
      const service = new VoyageAIEmbeddingService(config);
      service.initialize();
      return service;
    },
  });
}
