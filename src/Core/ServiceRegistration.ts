import { ServiceContainer } from "./ServiceContainer";
import { ServiceLifetime } from "./IService";
import { ImportanceEvaluatorService } from "../Memory/Services/ImportanceEvaluatorService";
import { MemoryCompressorService } from "../Memory/Services/MemoryCompressorService";
import { config } from "../Config";

/**
 * 注册所有内置服务
 * @param container 服务容器
 */
export function registerCoreServices(container: ServiceContainer): void {
  // 获取模型配置
  const modelConfig = config.getCurrentModel();
  const memoryConfig = config.settings.memory;

  if (!modelConfig) {
    throw new Error("模型配置未设置，无法注册服务");
  }

  // 注册重要性评估服务（单例）
  container.addSingleton(
    "ImportanceEvaluatorService",
    ImportanceEvaluatorService,
    {
      enabled: memoryConfig?.enabled !== false,
      config: {
        apiKey: modelConfig.apiKey,
        baseURL: modelConfig.baseURL,
        model: "gpt-3.5-turbo",
        enabled: true
      }
    }
  );

  // 注册记忆压缩服务（单例）
  container.addSingleton(
    "MemoryCompressorService",
    MemoryCompressorService,
    {
      enabled: memoryConfig?.enabled !== false,
      config: {
        apiKey: modelConfig.apiKey,
        baseURL: modelConfig.baseURL,
        model: "gpt-3.5-turbo",
        enabled: true
      }
    }
  );

  // 可以继续添加其他服务...
  // container.addScoped("OtherService", OtherService);
}

/**
 * 为用户创建作用域容器并注册用户级服务
 */
export function createUserServiceContainer(
  rootContainer: ServiceContainer,
  userId: string
): ServiceContainer {
  const userContainer = rootContainer.createScope(`user:${userId}`);

  // 注册用户级别的服务（作用域服务）
  // 例如：用户特定的缓存、会话管理等
  // userContainer.addScoped("UserCacheService", UserCacheService);

  return userContainer;
}
