import { ILogger } from "./ILogger";

/**
 * Logger 服务接口
 * 负责创建和管理日志记录器实例
 */
export interface ILoggerService {
  /**
   * 获取指定名称的 Logger 实例
   * @param name Logger 名称（通常是文件名或模块名）
   */
  getLogger(name: string): ILogger;
}

/**
 * ILoggerService 的依赖注入 token
 * 使用 Symbol 确保唯一性，避免命名冲突
 */
export const ILoggerService = Symbol("ILoggerService");
