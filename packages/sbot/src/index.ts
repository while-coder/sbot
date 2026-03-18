#!/usr/bin/env node
// 第一行必须导入 logger 配置，确保 log4js 在所有模块加载前初始化
import {LoggerService, log4js} from "./Core/LoggerService";
import {config} from "./Core/Config";
import {database} from "./Core/Database";
import { channelManager } from "./Channel/ChannelManager";
import {httpServer} from "./Server/HttpServer";
import {initGlobalAgentToolService} from "./Agent/GlobalAgentToolService";
import {initGlobalSkillService} from "./Agent/GlobalSkillService";
import {schedulerService} from "./Scheduler/SchedulerService";
import { Command } from "commander";
import path from "path";

const logger = LoggerService.getLogger('index.ts');

const program = new Command();
program
    .name('sbot')
    .description(config.pkg.description)
    .version(config.pkg.version, '-v, --version');

// 设置端口命令：修改并保存端口，不启动服务
program
    .command('port <port>')
    .description('设置 HTTP 服务端口并保存')
    .action((portStr: string) => {
        const port = Number(portStr);
        if (!Number.isInteger(port) || port <= 0 || port >= 65536) {
            console.error(`端口无效: ${portStr}`);
            process.exit(1);
        }
        config.setHttpPort(port);
        console.log(`端口已更新为 ${port}`);
    });

// 显示配置目录
// program
//     .command('config')
//     .description('显示配置目录路径')
//     .action(() => {
//         const configDir = path.dirname(config.getConfigPath('settings.json'));
//         console.log(configDir);
//     });

// 默认行为：启动服务
program
    .action(async (options: { port?: string }) => {
        if (options.port) {
            const port = Number(options.port);
            if (Number.isInteger(port) && port > 0 && port < 65536) {
                config.setHttpPort(port);
                logger.info(`端口已更新为 ${port}`);
            } else {
                logger.warn(`--port 参数无效: ${options.port}`);
            }
        }
        await main();
    });

program.parseAsync(process.argv);

async function main() {
    logger.info("=========================开始启动=========================")
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
