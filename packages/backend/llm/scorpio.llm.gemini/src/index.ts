import {
  ApiKeyMode,
  EmbeddingProvider,
  type LlmProviderRegistry,
  ModelProvider,
  llmProviderRegistry,
} from "scorpio.llm";
import { GeminiImageModelService } from "./GeminiImageModelService";
import { GeminiModelService } from "./GeminiModelService";
import { GoogleEmbeddingService } from "./GoogleEmbeddingService";

export { GeminiModelService, GeminiImageModelService, GoogleEmbeddingService };

const geminiConfigSchema = {
  apiVersion: {
    label: "API 版本",
    type: "string" as const,
    default: "v1",
    description: "Google Generative Language API 版本，例如 v1 或 v1beta",
  },
};

export function registerGeminiProvider(registry: LlmProviderRegistry = llmProviderRegistry): void {
  registry.registerModel({
    type: ModelProvider.Gemini,
    label: "Google Gemini",
    configSchema: geminiConfigSchema,
    defaults: {
      baseURL: "https://generativelanguage.googleapis.com",
      config: { apiVersion: "v1" },
    },
    apiKeyMode: ApiKeyMode.Required,
    createModel: config => {
      const service = new GeminiModelService(config);
      service.initialize();
      return service;
    },
  });
  registry.registerModel({
    type: ModelProvider.GeminiImage,
    label: "Google Gemini Image",
    configSchema: geminiConfigSchema,
    defaults: {
      baseURL: "https://generativelanguage.googleapis.com",
      config: { apiVersion: "v1" },
    },
    apiKeyMode: ApiKeyMode.Required,
    createModel: config => {
      const service = new GeminiImageModelService(config);
      service.initialize();
      return service;
    },
  });
  registry.registerEmbedding({
    type: EmbeddingProvider.Gemini,
    label: "Google Gemini",
    configSchema: {
      taskType: {
        label: "任务类型",
        type: "select",
        description: "当前 SDK 仅对 embedding-001 模型支持任务类型",
        options: [
          { label: "不指定", value: "" },
          { label: "检索查询", value: "RETRIEVAL_QUERY" },
          { label: "检索文档", value: "RETRIEVAL_DOCUMENT" },
          { label: "语义相似度", value: "SEMANTIC_SIMILARITY" },
          { label: "分类", value: "CLASSIFICATION" },
          { label: "聚类", value: "CLUSTERING" },
        ],
      },
      title: {
        label: "文档标题",
        type: "string",
        description: "仅检索文档任务使用",
        showWhen: { field: "taskType", eq: "RETRIEVAL_DOCUMENT" },
      },
    },
    defaults: {
      baseURL: "https://generativelanguage.googleapis.com",
      model: "text-embedding-004",
    },
    apiKeyMode: ApiKeyMode.Required,
    createEmbedding: config => {
      const service = new GoogleEmbeddingService(config);
      service.initialize();
      return service;
    },
  });
}
