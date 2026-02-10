import path from "path";
import log4js from "log4js";
import { ILogger, ILoggerService, GlobalLoggerService } from "scorpio.ai";
import { config } from "./Config";

// 确保日志目录存在并获取路径
const logsDir = config.getConfigPath("logs", true);

// 配置 log4js
log4js.configure({
    appenders: {
        console: {
            type: "console",
            layout: {
                type: "pattern",
                pattern: "[%d{yyyy-MM-dd hh:mm:ss:SSS}] [%p] %c:%l - %m",
            },
        },
        file: {
            type: "dateFile",
            encoding: "utf-8",
            filename: path.join(logsDir, "log"),
            alwaysIncludePattern: true,
            numBackups: 7,
            pattern: "yyyy-MM-dd.log",
            layout: {
                type: "pattern",
                pattern: "[%d{yyyy-MM-dd hh:mm:ss}][%p] %c:%l - %m",
            },
        },
    },
    categories: {
        default: {
            enableCallStack: true,
            appenders: ["console", "file"],
            level: "ALL",
        },
    },
});

/**
 * Log4js Logger 包装器，实现 ILogger 接口
 */
class Log4jsLoggerAdapter implements ILogger {
    constructor(private logger: log4js.Logger) {}

    debug(message: string, ...args: any[]): void {
        this.logger.debug(message, ...args);
    }

    info(message: string, ...args: any[]): void {
        this.logger.info(message, ...args);
    }

    warn(message: string, ...args: any[]): void {
        this.logger.warn(message, ...args);
    }

    error(message: string, ...args: any[]): void {
        this.logger.error(message, ...args);
    }
}

/**
 * Log4js LoggerService 实现
 */
class Log4jsLoggerService extends ILoggerService {
    getLogger(name: string): ILogger {
        const log4jsLogger = log4js.getLogger(name);
        return new Log4jsLoggerAdapter(log4jsLogger);
    }
}

// 配置全局 LoggerService
GlobalLoggerService.setLoggerService(new Log4jsLoggerService());

/**
 * LoggerService - 日志服务类（向后兼容的静态方法）
 */
export class LoggerService {
    /**
     * 获取 logger 实例
     * @param name logger 名称
     * @returns logger 实例
     */
    static getLogger(name: string): ILogger {
        return GlobalLoggerService.getLogger(name)!;
    }
}

// 导出 log4js 供特殊场景使用
export { log4js };
