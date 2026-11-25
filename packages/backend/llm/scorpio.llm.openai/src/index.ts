import {
  ApiKeyMode,
  type LlmProviderRegistry,
  ModelProvider,
  llmProviderRegistry,
} from "scorpio.llm";
import { OpenAIModelService } from "./OpenAIModelService";
import { OpenAIResponseModelService } from "./OpenAIResponseModelService";

export { OpenAIModelService, OpenAIResponseModelService };

export function registerOpenAIProvider(registry: LlmProviderRegistry = llmProviderRegistry): void {
  registry.registerModel({
    type: ModelProvider.OpenAI,
    label: "OpenAI Compatible",
    configSchema: {},
    defaults: { baseURL: "https://api.openai.com/v1" },
    apiKeyMode: ApiKeyMode.Required,
    createModel: config => {
      const service = new OpenAIModelService(config);
      service.initialize();
      return service;
    },
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
    apiKeyMode: ApiKeyMode.Required,
    createModel: config => {
      const service = new OpenAIResponseModelService(config);
      service.initialize();
      return service;
    },
  });
}
