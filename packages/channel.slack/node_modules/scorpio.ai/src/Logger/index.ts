/**
 * Logger 模块
 * 提供独立的日志服务，不依赖第三方库
 */

// ===== 接口 + Symbol Token =====
export { ILogger } from "./ILogger";
export { ILoggerService } from "./ILoggerService";

// ===== 全局单例 =====
export { GlobalLoggerService } from "./GlobalLoggerService";
