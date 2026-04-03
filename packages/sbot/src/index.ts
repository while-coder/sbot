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
import { enableAutoStart, disableAutoStart, isAutoStartEnabled } from "./Core/AutoStart";

const logger = LoggerService.getLogger('index.ts');

function applyPort(portStr: string, onInvalid: (msg: string) => void): void {
    const port = Number(portStr);
    if (!Number.isInteger(port) || port <= 0 || port >= 65536) {
        onInvalid(`Invalid port: ${portStr}`);
        return;
    }
    config.setHttpPort(port);
}

const program = new Command();
program
    .name('sbot')
    .description(config.pkg.description)
    .version(config.pkg.version, '-v, --version')
    .option('-p, --port <port>', 'HTTP server port');

// 设置端口命令：修改并保存端口，不启动服务
program
    .command('port <port>')
    .description('设置 HTTP 服务端口并保存')
    .action((portStr: string) => {
        applyPort(portStr, msg => { console.error(msg); process.exit(1); });
        console.log(`Port updated to ${portStr}`);
    });

// 开机启动
program
    .command('startup')
    .description('管理开机自启动')
    .addCommand(
        new Command('enable')
            .description('开启开机自启动')
            .action(() => {
                try {
                    enableAutoStart();
                    console.log('已开启开机自启动');
                } catch (e: any) {
                    console.error(`开启失败: ${e.message}`);
                    process.exit(1);
                }
            }),
    )
    .addCommand(
        new Command('disable')
            .description('取消开机自启动')
            .action(() => {
                try {
                    disableAutoStart();
                    console.log('已取消开机自启动');
                } catch (e: any) {
                    console.error(`取消失败: ${e.message}`);
                    process.exit(1);
                }
            }),
    )
    .addCommand(
        new Command('status')
            .description('查看开机自启动状态')
            .action(() => {
                const enabled = isAutoStartEnabled();
                console.log(`开机自启动: ${enabled ? '已开启' : '未开启'}`);
            }),
    );

// 默认行为：启动服务
program
    .action(async (options: { port?: string }) => {
        if (options.port) {
            applyPort(options.port, msg => logger.warn(msg));
        }
        await main();
    });

program.parseAsync(process.argv);

async function main() {
    logger.info("=========================Starting===========================")
    try {
        //监听未捕获的异常
        process.on('uncaughtException', function(err, origin) {
            logger.error(`Uncaught exception: ${err?.stack}\n${origin}`)
        })

        await database.init()
        initGlobalAgentToolService()
        initGlobalSkillService()
        await channelManager.init()
        await httpServer.start()
        await schedulerService.start()

        logger.info("=========================Started successfully=============")
    } catch (e) {
        logger.error("=========================Startup failed==================")
        if (e instanceof Error) {
            logger.error(`Error: ${e.message}`)
            logger.error(`Config file path: ${config.getConfigPath("settings.json")}`)
            logger.error("Please check the configuration file and restart with correct settings")
        } else {
            logger.error("Unknown error:", e)
        }
        logger.error("=============================================================")
        // 确保日志刷新到磁盘后再退出
        log4js.shutdown(() => {
            process.exit(1)
        })
    }
}
