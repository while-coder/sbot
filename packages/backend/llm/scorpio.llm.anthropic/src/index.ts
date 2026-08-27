import { ApiKeyMode, type LlmProviderRegistry, ModelProvider, llmProviderRegistry } from "scorpio.llm";
import { AnthropicModelService } from "./AnthropicModelService";

export { AnthropicModelService };

export function registerAnthropicProvider(registry: LlmProviderRegistry = llmProviderRegistry): void {
  registry.registerModel({
    type: ModelProvider.Anthropic,
    label: "Anthropic",
    configSchema: {
      thinkingType: {
        label: "思考模式",
        type: "select",
        options: [
          { label: "不配置", value: "" },
          { label: "自适应", value: "adaptive" },
          { label: "启用", value: "enabled" },
          { label: "禁用", value: "disabled" },
        ],
      },
      thinkingBudget: {
        label: "思考 Token 预算",
        type: "number",
        default: 8192,
        description: "仅在思考模式为启用时生效",
        showWhen: { field: "thinkingType", eq: "enabled" },
      },
      promptCaching: {
        label: "Prompt 缓存",
        type: "boolean",
        default: false,
        description: "为系统提示和工具定义添加临时缓存标记",
      },
    },
    defaults: { baseURL: "https://api.anthropic.com" },
    apiKeyMode: ApiKeyMode.Required,
    createModel: config => {
      const service = new AnthropicModelService(config);
      service.initialize();
      return service;
    },
  });
}
