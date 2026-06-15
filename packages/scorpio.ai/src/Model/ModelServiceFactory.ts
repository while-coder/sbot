import { IModelService } from "./IModelService";
import { OpenAIModelService } from "./OpenAIModelService";
import { OpenAIResponseModelService } from "./OpenAIResponseModelService";
import { OllamaModelService } from "./OllamaModelService";
import { AnthropicModelService } from "./AnthropicModelService";
import { GeminiModelService } from "./GeminiModelService";
import { GeminiImageModelService } from "./GeminiImageModelService";
import { RetryModelServiceProxy } from "./RetryModelServiceProxy";
import { ModelConfig, ModelProvider } from "./types";

/**
 * 模型服务工厂
 *
 * 根据 ModelConfig 创建对应的 ModelService 实例。
 * 未知提供者默认回退到 OpenAI 兼容模式（适用于 Azure、Groq、Mistral、DeepSeek 等兼容 API）。
 *
 * @example
 * ```ts
 * const service = ModelServiceFactory.getModelService({ provider: "openai", model: "gpt-4", apiKey: "sk-..." });
 * ```
 */
export class ModelServiceFactory {
  /**
   * 创建指定模型的服务实例（同步；底层 ChatXxx 构造均为同步）
   * @param config 模型配置
   * @returns 模型服务实例
   */
  static getModelService(config: ModelConfig): IModelService {
    switch (config.provider) {
      case ModelProvider.Anthropic: {
        const service = new AnthropicModelService(config);
        service.initialize();
        return new RetryModelServiceProxy(service);
      }
      case ModelProvider.Ollama: {
        const service = new OllamaModelService(config);
        service.initialize();
        return new RetryModelServiceProxy(service);
      }
      case ModelProvider.OpenAIResponse: {
        const service = new OpenAIResponseModelService(config);
        service.initialize();
        return new RetryModelServiceProxy(service);
      }
      case ModelProvider.GeminiImage: {
        const service = new GeminiImageModelService(config);
        service.initialize();
        return new RetryModelServiceProxy(service);
      }
      case ModelProvider.Gemini: {
        const service = new GeminiModelService(config);
        service.initialize();
        return new RetryModelServiceProxy(service);
      }
      // OpenAI, Azure, Groq, Mistral, DeepSeek, and any OpenAI-compatible provider
      default: {
        const service = new OpenAIModelService(config);
        service.initialize();
        return new RetryModelServiceProxy(service);
      }
    }
  }
}
