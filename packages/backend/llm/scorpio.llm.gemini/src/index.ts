import {
  EmbeddingProvider,
  type LlmProviderRegistry,
  ModelProvider,
  llmProviderRegistry,
} from "scorpio.llm";
import { GeminiImageModelService } from "./GeminiImageModelService";
import { GeminiModelService } from "./GeminiModelService";
import { GoogleEmbeddingService } from "./GoogleEmbeddingService";
import { GEMINI_IMAGE_MODEL_CATALOG, GEMINI_MODEL_CATALOG } from "./modelCatalog";

export { GeminiModelService, GeminiImageModelService, GoogleEmbeddingService, GEMINI_MODEL_CATALOG, GEMINI_IMAGE_MODEL_CATALOG };

const geminiConfigSchema = {
  apiVersion: {
    label: "API 版本",
    type: "string" as const,
    default: "v1",
    description: "Google Generative Language API 版本，例如 v1 或 v1beta",
  },
};

async function listGeminiModels(config: any, imageFirst: boolean): Promise<string[]> {
  if (!config.apiKey) throw new Error("apiKey is required for Gemini");
  const textModels = Object.keys(GEMINI_MODEL_CATALOG);
  const imageModels = Object.keys(GEMINI_IMAGE_MODEL_CATALOG);
  const base = (config.baseURL || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  const apiVersion = config.config?.apiVersion ?? "v1";
  try {
    const res = await fetch(`${base}/${apiVersion}/models`, { headers: { "x-goog-api-key": config.apiKey } });
    if (!res.ok) throw new Error(`${res.status}`);
    const data: any = await res.json();
    return (data.models || []).map((model: any) => (model.name as string).replace(/^models\//, ""));
  } catch {
    return imageFirst ? [...imageModels, ...textModels] : [...textModels, ...imageModels];
  }
}

async function listGeminiEmbeddings(config: any): Promise<string[]> {
  if (!config.apiKey) throw new Error("apiKey is required for Gemini");
  const base = (config.baseURL || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/v1/models`, { headers: { "x-goog-api-key": config.apiKey } });
    if (!res.ok) throw new Error(`${res.status}`);
    const data: any = await res.json();
    return (data.models || [])
      .filter((model: any) => model.supportedGenerationMethods?.includes("embedContent"))
      .map((model: any) => (model.name as string).replace(/^models\//, ""));
  } catch {
    return ["text-embedding-004", "embedding-001"];
  }
}

export function registerGeminiProvider(registry: LlmProviderRegistry = llmProviderRegistry): void {
  registry.registerModel({
    type: ModelProvider.Gemini,
    label: "Google Gemini",
    configSchema: geminiConfigSchema,
    defaults: {
      baseURL: "https://generativelanguage.googleapis.com",
      config: { apiVersion: "v1" },
    },
    apiKeyRequired: true,
    createModel: config => {
      const service = new GeminiModelService(config);
      service.initialize();
      return service;
    },
    listModels: config => listGeminiModels(config, false),
  });
  registry.registerModel({
    type: ModelProvider.GeminiImage,
    label: "Google Gemini Image",
    configSchema: geminiConfigSchema,
    defaults: {
      baseURL: "https://generativelanguage.googleapis.com",
      config: { apiVersion: "v1" },
    },
    apiKeyRequired: true,
    createModel: config => {
      const service = new GeminiImageModelService(config);
      service.initialize();
      return service;
    },
    listModels: config => listGeminiModels(config, true),
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
    apiKeyRequired: true,
    createEmbedding: config => {
      const service = new GoogleEmbeddingService(config);
      service.initialize();
      return service;
    },
    listEmbeddings: listGeminiEmbeddings,
  });
}
