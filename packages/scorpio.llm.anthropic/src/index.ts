import { type LlmProviderRegistry, ModelProvider, llmProviderRegistry } from "scorpio.llm";
import { AnthropicModelService } from "./AnthropicModelService";

export { AnthropicModelService };

export function registerAnthropicProvider(registry: LlmProviderRegistry = llmProviderRegistry): void {
  registry.registerModel(ModelProvider.Anthropic, config => {
    const service = new AnthropicModelService(config);
    service.initialize();
    return service;
  });
}
