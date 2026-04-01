import { IModelService } from "./IModelService";
import { OpenAIModelService } from "./OpenAIModelService";
import { OpenAIResponseModelService } from "./OpenAIResponseModelService";
import { OllamaModelService } from "./OllamaModelService";
import { AnthropicModelService } from "./AnthropicModelService";
import { GeminiModelService } from "./GeminiModelService";
import { ModelConfig, ModelProvider } from "./types";

/**
 * 模型服务工厂
 *
 * 根据 ModelConfig 创建对应的 ModelService 实例。
 * 未知提供者默认回退到 OpenAI 兼容模式（适用于 Azure、Groq、Mistral、DeepSeek 等兼容 API）。
 *
 * @example
 * ```ts
 * const service = await ModelServiceFactory.getModelService({ provider: "openai", model: "gpt-4", apiKey: "sk-..." });
 * ```
 */
export class ModelServiceFactory {
  /**
   * 创建指定模型的服务实例
   * @param config 模型配置
   * @returns 模型服务实例
   */
  static async getModelService(config: ModelConfig): Promise<IModelService> {
    switch (config.provider) {
      case ModelProvider.Anthropic: {
        const service = new AnthropicModelService(config);
        await service.initialize();
        return service;
      }
      case ModelProvider.Ollama: {
        const service = new OllamaModelService(config);
        await service.initialize();
        return service;
      }
      case ModelProvider.OpenAIResponse: {
        const service = new OpenAIResponseModelService(config);
        await service.initialize();
        return service;
      }
      case ModelProvider.Gemini: {
        const service = new GeminiModelService(config);
        await service.initialize();
        return service;
      }
      // OpenAI, Azure, Groq, Mistral, DeepSeek, and any OpenAI-compatible provider
      default: {
        const service = new OpenAIModelService(config);
        await service.initialize();
        return service;
      }
    }
  }
}
