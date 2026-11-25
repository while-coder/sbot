import {
  ApiKeyMode,
  type LlmProviderRegistry,
  ModelProvider,
  llmProviderRegistry,
} from "scorpio.llm";
import { GeminiImageModelService } from "./GeminiImageModelService";
import { GeminiModelService } from "./GeminiModelService";

export { GeminiModelService, GeminiImageModelService };

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
}
