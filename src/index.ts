import path from "path";
import log4js from "log4js";
import {config} from "./Config";
import {database} from "./Database";
import {larkService} from "./LarkService";

// 确保日志目录存在并获取路径
const logsDir = config.getConfigPath("logs", true);

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

        // 验证配置
        logger.info("正在验证配置...")
        config.validateConfig()
        logger.info("配置验证完成")

        await database.init()

        await larkService.start()

        logger.info("=========================启动成功=========================")
    } catch (e) {
        logger.error("=========================启动失败=========================")
        if (e instanceof Error) {
            logger.error(`错误信息: ${e.message}`)
            logger.error(`配置文件路径: ${config.getConfigPath("settings.toml")}`)
            logger.error("请检查配置文件并填写正确的配置信息后重新启动")
        } else {
            logger.error("未知错误:", e)
        }
        logger.error("=============================================================")
        process.exit(1)
    }
}
main().then(() => {})