// 第一行必须导入 logger 配置，确保 log4js 在所有模块加载前初始化
import {getLogger, log4js} from "./logger";
import {config} from "./Config";
import {database} from "./Database";
import {larkService} from "./Lark/LarkService";

const logger = getLogger('index.ts');
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
        // 确保日志刷新到磁盘后再退出
        log4js.shutdown(() => {
            process.exit(1)
        })
    }
}
main().then(() => {})