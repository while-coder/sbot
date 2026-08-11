import { type IModelService, type ModelConfig, llmProviderRegistry } from "scorpio.llm";
import { RetryModelServiceProxy } from "./RetryModelServiceProxy";

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
    return new RetryModelServiceProxy(llmProviderRegistry.createModel(config));
  }
}
