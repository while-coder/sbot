import { Container, container } from "./Container";
import { ImportanceEvaluatorService } from "../Memory/Services/ImportanceEvaluatorService";
import { MemoryCompressorService } from "../Memory/Services/MemoryCompressorService";
import { config } from "../Config";

/**
 * 注册所有内置服务到容器
 *
 * 新 API 使用方式：服务类通过 @singleton() 装饰器自动标记生命周期，
 * 这里只需注册配置值，服务会在首次 resolve 时自动创建和初始化。
 *
 * @param c 容器实例（默认使用全局容器）
 */
export function registerCoreServices(c: Container = container): void {
  // 获取模型配置
  const modelConfig = config.getCurrentModel();
  const memoryConfig = config.settings.memory;

  if (!modelConfig) {
    throw new Error("模型配置未设置，无法注册服务");
  }

  const enabled = memoryConfig?.enabled !== false;

  // 注册配置值（服务通过 @inject("xxx") 自动获取）
  c.registerInstance("ImportanceEvaluatorConfig", {
    apiKey: modelConfig.apiKey,
    baseURL: modelConfig.baseURL,
    model: "gpt-3.5-turbo",
    enabled,
  });

  c.registerInstance("MemoryCompressorConfig", {
    apiKey: modelConfig.apiKey,
    baseURL: modelConfig.baseURL,
    model: "gpt-3.5-turbo",
    enabled,
  });

  // 服务类已通过 @singleton() 装饰器标记，
  // 首次 container.resolve(ImportanceEvaluatorService) 时会自动注册、创建并初始化。
  // 如果需要提前注册（可选），可以显式调用：
  c.registerSingleton(ImportanceEvaluatorService);
  c.registerSingleton(MemoryCompressorService);
}

/**
 * @deprecated 使用新的容器 API 代替
 */
export function createUserServiceContainer(
  _rootContainer: any,
  _userId: string
): any {
  // 新 API 不再需要作用域容器的概念来管理用户级服务
  // 如果需要用户级隔离，可以创建新的 Container 实例
  return new Container();
}
