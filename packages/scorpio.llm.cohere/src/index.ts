import { EmbeddingProvider, type LlmProviderRegistry, llmProviderRegistry } from "scorpio.llm";
import { CohereEmbeddingService } from "./CohereEmbeddingService";

export { CohereEmbeddingService };

export function registerCohereProvider(registry: LlmProviderRegistry = llmProviderRegistry): void {
  registry.registerEmbedding({
    type: EmbeddingProvider.Cohere,
    label: "Cohere",
    configSchema: {
      batchSize: {
        label: "批处理数量",
        type: "number",
        description: "单次请求包含的最大文档数量，最大 96",
      },
    },
    defaults: { model: "embed-v4.0" },
    baseURLEnabled: false,
    apiKeyRequired: true,
    createEmbedding: config => {
      const service = new CohereEmbeddingService(config);
      service.initialize();
      return service;
    },
  });
}
