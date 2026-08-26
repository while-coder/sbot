import { type LlmProviderRegistry, llmProviderRegistry } from "scorpio.llm";
import { OpenAIModelService } from "scorpio.llm.openai";

/** OrcaRouter provider id, kept stable so saved model configs keep working. */
export const OrcaRouterProvider = "orcarouter";

export function registerOrcaRouterProvider(registry: LlmProviderRegistry = llmProviderRegistry): void {
  registry.registerModel({
    type: OrcaRouterProvider,
    label: "OrcaRouter",
    configSchema: {},
    defaults: { baseURL: "https://api.orcarouter.ai/v1", model: "orcarouter/fusion" },
    apiKeyRequired: true,
    createModel: config => {
      const service = new OpenAIModelService(config);
      service.initialize();
      return service;
    },
    listModels: async config => {
      if (!config.apiKey) throw new Error("apiKey is required for OrcaRouter");
      const base = (config.baseURL || "https://api.orcarouter.ai/v1").replace(/\/$/, "");
      const res = await fetch(`${base}/models`, {
        headers: { Authorization: `Bearer ${config.apiKey}` },
      });
      if (!res.ok) throw new Error(`Models request failed: ${res.status}`);
      const data: any = await res.json();
      return (data.data || []).map((model: any) => model.id as string);
    },
  });
}
