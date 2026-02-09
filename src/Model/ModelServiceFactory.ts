import { config } from "../Config";
import { IModelService } from "./IModelService";
import { OpenAIModelService } from "./OpenAIModelService";
import { LoggerService } from "../LoggerService";

const logger = LoggerService.getLogger("ModelServiceFactory");

/**
 * 模型服务工厂
 *
 * 负责创建和缓存 ModelService 实例，确保相同 modelName 返回同一个实例。
 *
 * @example
 * ```ts
 * const model1 = await ModelServiceFactory.getModelService("gpt-4");
 * const model2 = await ModelServiceFactory.getModelService("gpt-4");
 * // model1 === model2 (同一个实例)
 * ```
 */
export class ModelServiceFactory {
  private static readonly cache = new Map<string, IModelService>();

  /**
   * 获取指定模型的服务实例（带缓存）
   * @param modelName 模型名称
   * @returns 模型服务实例
   */
  static async getModelService(modelName: string): Promise<IModelService> {
    // 从缓存中获取
    if (this.cache.has(modelName)) {
      return this.cache.get(modelName)!;
    }

    // 创建新实例
    const service = await this.createModelService(modelName);

    // 缓存
    this.cache.set(modelName, service);
    return service;
  }

  /**
   * 创建模型服务实例
   */
  private static async createModelService(modelName: string): Promise<IModelService> {
    const modelConfig = config.getModel(modelName);
    if (!modelConfig) {
      throw new Error(`模型配置 "${modelName}" 未找到`);
    }

    switch (modelConfig.provider) {
      case "openai":
        const service = new OpenAIModelService(modelConfig);
        await service.initialize();
        return service;
      default:
        throw new Error(`不支持的模型提供者: ${modelConfig.provider}`);
    }
  }

  /**
   * 清除缓存并释放所有模型服务资源
   */
  static async clearCache(): Promise<void> {
    // 调用每个缓存服务的 cleanup 方法
    for (const [modelName, service] of this.cache.entries()) {
      try {
        await service.cleanup();
      } catch (error: any) {
        logger.warn(`释放模型服务失败 (${modelName}): ${error.message}`);
      }
    }

    this.cache.clear();
  }

  /**
   * 检查是否已缓存
   */
  static hasCached(modelName: string): boolean {
    return this.cache.has(modelName);
  }

  /**
   * 获取缓存的模型列表
   */
  static getCachedModels(): string[] {
    return Array.from(this.cache.keys());
  }
}
