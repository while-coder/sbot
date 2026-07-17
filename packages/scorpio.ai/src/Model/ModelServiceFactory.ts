import { IModelService } from "./IModelService";
import { ModelServiceBase } from "./ModelServiceBase";
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
    let service: ModelServiceBase;
    switch (config.provider) {
      case ModelProvider.Anthropic:
        service = new AnthropicModelService(config);
        break;
      case ModelProvider.Ollama:
        service = new OllamaModelService(config);
        break;
      case ModelProvider.OpenAIResponse:
        service = new OpenAIResponseModelService(config);
        break;
      case ModelProvider.GeminiImage:
        service = new GeminiImageModelService(config);
        break;
      case ModelProvider.Gemini:
        service = new GeminiModelService(config);
        break;
      // OpenAI, Azure, Groq, Mistral, DeepSeek, and any OpenAI-compatible provider
      default:
        service = new OpenAIModelService(config);
        break;
    }
    service.initialize();
    return new RetryModelServiceProxy(service);
  }
}
