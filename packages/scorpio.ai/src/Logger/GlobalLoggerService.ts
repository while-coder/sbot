import { ILogger } from "./ILogger";
import { ILoggerService } from "./ILoggerService";

/**
 * Logger 服务实现
 */
class LoggerService {
  private loggerService: ILoggerService | undefined;
  setLoggerService(service: ILoggerService): void {
    this.loggerService = service;
  }

  getLogger(name: string): ILogger | undefined {
    return this.loggerService?.getLogger(name)
  }
}

/**
 * 全局 Logger 服务单例
 */
export const GlobalLoggerService = new LoggerService();
