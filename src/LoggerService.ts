import path from "path";
import log4js from "log4js";
import {config} from "./Config";

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
 * LoggerService - 日志服务类
 */
export class LoggerService {
    /**
     * 获取 logger 实例
     * @param name logger 名称
     * @returns logger 实例
     */
    static getLogger(name: string): log4js.Logger {
        return log4js.getLogger(name);
    }
}

// 导出 log4js 供特殊场景使用
export { log4js };
