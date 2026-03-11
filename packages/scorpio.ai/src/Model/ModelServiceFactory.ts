import { IModelService } from "./IModelService";
import { OpenAIModelService } from "./OpenAIModelService";
import { OllamaModelService } from "./OllamaModelService";
import { ModelConfig, ModelProvider } from "./types";

/**
 * 模型服务工厂
 *
 * 根据 ModelConfig 创建对应的 ModelService 实例。
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
      case ModelProvider.OpenAI: {
        const service = new OpenAIModelService(config);
        await service.initialize();
        return service;
      }
      case ModelProvider.Ollama: {
        const service = new OllamaModelService(config);
        await service.initialize();
        return service;
      }
      default:
        throw new Error(`不支持的模型提供者: ${config.provider}`);
    }
  }
}
