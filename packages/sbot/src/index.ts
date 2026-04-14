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
import { spawn, execSync } from "child_process";
import http from "http";
import { fetchLatestRelease, compareSemver, NPM_PACKAGE } from "sbot.commons";
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
    .option('-p, --port <port>', 'HTTP server port')
    .option('-d, --daemon', '后台运行');

// 设置端口命令：修改并保存端口，不启动服务
program
    .command('port <port>')
    .description('设置 HTTP 服务端口并保存')
    .action((portStr: string) => {
        applyPort(portStr, msg => { console.error(msg); process.exit(1); });
        console.log(`Port updated to ${portStr}`);
    });

// 查看状态
program
    .command('status')
    .description('查看 sbot 运行状态')
    .action(async () => {
        const port = config.getHttpPort();
        const [running, release] = await Promise.all([
            new Promise<boolean>(resolve => {
                const req = http.get(`http://localhost:${port}/`, () => resolve(true));
                req.on('error', () => resolve(false));
                req.setTimeout(2000, () => { req.destroy(); resolve(false); });
            }),
            fetchLatestRelease(),
        ]);
        const startup = isAutoStartEnabled();
        const currentVer = config.pkg.version;
        let versionInfo = currentVer;
        if (release && compareSemver(currentVer, release.tag) < 0) {
            versionInfo += ` (最新版: ${release.tag}, 可通过 npm install -g ${NPM_PACKAGE}@latest 升级)`;
        } else if (release) {
            versionInfo += ` (已是最新)`;
        }
        console.log(`sbot 状态:`);
        console.log(`  运行状态: ${running ? '运行中' : '未运行'}`);
        console.log(`  HTTP 端口: ${port}`);
        console.log(`  开机自启动: ${startup ? '已开启' : '未开启'}`);
        console.log(`  版本: ${versionInfo}`);
        console.log(`  配置目录: ${config.getConfigPath('.')}`);
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
    .action(async (options: { port?: string; daemon?: boolean }) => {
        if (options.daemon) {
            const args = process.argv.slice(2).filter(a => a !== '-d' && a !== '--daemon');
            const child = spawn(process.execPath, [__filename, ...args], {
                detached: true,
                stdio: 'ignore',
            });
            child.unref();
            console.log(`sbot 已在后台启动 (PID: ${child.pid})`);
            return;
        }
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

        // 执行启动命令
        const cmds = config.settings.startupCommands;
        if (cmds?.length) {
            for (const cmd of cmds) {
                logger.info(`Startup command: ${cmd}`);
                try {
                    execSync(cmd, { stdio: 'inherit' });
                } catch (e: any) {
                    logger.error(`Startup command failed: ${cmd} — ${e?.message ?? e}`);
                }
            }
        }

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
