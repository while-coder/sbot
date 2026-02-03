import path from "path";
import log4js from "log4js";
import {config} from "./Config";
import {database} from "./Database";
import {larkService} from "./LarkService";

// 确保日志目录存在并获取路径
const logsDir = config.ensureSubDir("logs");

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
const logger = log4js.getLogger('index.js')
logger.info("=========================开始启动=========================")

async function main() {
    try {
        //监听未捕获的异常
        process.on('uncaughtException', function(err, origin) {
            logger.error(`未捕获的异常:${err?.stack}\n${origin}`)
        })
        await database.init()
        await larkService.init()
    } catch (e) {
        logger.error("启动失败 : ", e)
    }
}
main().then(() => {})