// 第一行必须导入 logger 配置，确保 log4js 在所有模块加载前初始化
import {LoggerService, log4js} from "./Core/LoggerService";
import {config} from "./Core/Config";
import {database} from "./Core/Database";
import { channelManager } from "./Channel/ChannelManager";
import {httpServer} from "./Server/HttpServer";
import {initGlobalAgentToolService} from "./Agent/GlobalAgentToolService";
import {initGlobalSkillService} from "./Agent/GlobalSkillService";
import {schedulerService} from "./Scheduler/SchedulerService";
const logger = LoggerService.getLogger('index.ts');
logger.info("=========================开始启动=========================")

async function main() {
    try {
        //监听未捕获的异常
        process.on('uncaughtException', function(err, origin) {
            logger.error(`未捕获的异常:${err?.stack}\n${origin}`)
        })

        await database.init()
        initGlobalAgentToolService()
        initGlobalSkillService()
        await channelManager.init()
        await httpServer.start()
        await schedulerService.start()

        logger.info("=========================启动成功=========================")
    } catch (e) {
        logger.error("=========================启动失败=========================")
        if (e instanceof Error) {
            logger.error(`错误信息: ${e.message}`)
            logger.error(`配置文件路径: ${config.getConfigPath("settings.json")}`)
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