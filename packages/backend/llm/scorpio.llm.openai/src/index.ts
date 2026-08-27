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

async function listOpenAIModels(config: { baseURL?: string; apiKey: string }): Promise<string[]> {
  if (!config.baseURL) throw new Error("baseURL is required");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  const res = await fetch(`${config.baseURL.replace(/\/$/, "")}/models`, { headers });
  if (!res.ok) throw new Error(`Models request failed: ${res.status}`);
  const data: any = await res.json();
  return (data.data || [])
    .sort((a: any, b: any) => (b.created ?? 0) - (a.created ?? 0))
    .map((model: any) => model.id as string);
}

export function registerOpenAIProvider(registry: LlmProviderRegistry = llmProviderRegistry): void {
  registry.registerModel({
    type: ModelProvider.OpenAI,
    label: "OpenAI Compatible",
    configSchema: {},
    defaults: { baseURL: "https://api.openai.com/v1" },
    apiKeyRequired: true,
    createModel: config => {
      const service = new OpenAIModelService(config);
      service.initialize();
      return service;
    },
    listModels: listOpenAIModels,
  });
  registry.registerModel({
    type: ModelProvider.OpenAIResponse,
    label: "OpenAI Responses",
    configSchema: {
      responseItemReplay: {
        label: "历史 Item 回放",
        type: "select",
        options: [
          { label: "完整保留（推荐）", value: "preserve" },
          { label: "仅保留 call_id（兼容网关）", value: "call_id_only" },
        ],
        default: "preserve",
        description: "兼容网关无法校验 reasoning/function_call item 关联时，改用仅保留 call_id",
      },
    },
    defaults: { baseURL: "https://api.openai.com/v1", config: { responseItemReplay: "preserve" } },
    apiKeyRequired: true,
    createModel: config => {
      const service = new OpenAIResponseModelService(config);
      service.initialize();
      return service;
    },
    listModels: listOpenAIModels,
  });
  registry.registerEmbedding({
    type: EmbeddingProvider.OpenAI,
    label: "OpenAI Compatible",
    configSchema: {
      dimensions: {
        label: "向量维度",
        type: "number",
        description: "仅 text-embedding-3 及后续模型支持",
      },
    },
    defaults: {
      baseURL: "https://api.openai.com/v1",
      model: "text-embedding-ada-002",
    },
    apiKeyRequired: true,
    createEmbedding: config => {
      const service = new OpenAIEmbeddingService(config);
      service.initialize();
      return service;
    },
    listEmbeddings: listOpenAIModels,
  });
}
