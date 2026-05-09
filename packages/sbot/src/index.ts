#!/usr/bin/env node
import { Command } from "commander";
import { spawn, execSync } from "child_process";
import http from "http";
import { fetchLatestRelease, compareSemver, NPM_PACKAGE } from "sbot.commons";
import { enableAutoStart, disableAutoStart, isAutoStartEnabled } from "./Core/AutoStart";
import { config } from "./Core/Config";

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
    .option('-v, --version', '显示版本号并检查更新')
    .option('-p, --port <port>', 'HTTP server port')
    .option('-d, --daemon', '后台运行');

// 关闭服务命令
program
    .command('stop')
    .description('关闭正在运行的 sbot 服务')
    .action(async () => {
        const port = config.getHttpPort();
        try {
            const req = http.request(`http://localhost:${port}/api/shutdown`, { method: 'POST' }, (res) => {
                if (res.statusCode === 200) {
                    console.log('sbot 服务正在关闭...');
                } else {
                    console.error(`关闭失败，HTTP 状态码: ${res.statusCode}`);
                    process.exit(1);
                }
            });
            req.on('error', () => {
                console.error('sbot 服务未运行');
                process.exit(1);
            });
            req.setTimeout(5000, () => {
                req.destroy();
                console.error('请求超时，服务可能未运行');
                process.exit(1);
            });
            req.end();
        } catch {
            console.error('sbot 服务未运行');
            process.exit(1);
        }
    });

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
    .action(async (options: { port?: string; daemon?: boolean; version?: boolean }) => {
        if (options.version) {
            const currentVer = config.pkg.version;
            console.log(`sbot v${currentVer}`);
            try {
                const release = await fetchLatestRelease();
                if (release && compareSemver(currentVer, release.tag) < 0) {
                    console.log(`最新版: ${release.tag}, 可通过 npm install -g ${NPM_PACKAGE}@latest 升级`);
                } else if (release) {
                    console.log('已是最新版本');
                }
            } catch {}
            return;
        }
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
            applyPort(options.port, msg => console.warn(msg));
        }
        await main();
    });

program.parseAsync(process.argv);

async function main() {
    // 延迟加载重模块，避免 CLI 子命令（stop/status/port）承担启动开销
    const { LoggerService, log4js } = await import("./Core/LoggerService");
    const { setMaxImageSize } = await import("scorpio.ai");
    const { database } = await import("./Core/Database");
    const { channelManager } = await import("./Channel/ChannelManager");
    const { httpServer } = await import("./Server/HttpServer");
    const { initGlobalAgentToolService } = await import("./Agent/GlobalAgentToolService");
    const { initGlobalSkillService } = await import("./Agent/GlobalSkillService");
    const { schedulerService } = await import("./Scheduler/SchedulerService");
    const { heartbeatService } = await import("./Heartbeat/HeartbeatService");

    const logger = LoggerService.getLogger('index.ts');
    logger.info("=========================Starting===========================")
    try {
        process.on('uncaughtException', function(err, origin) {
            logger.error(`Uncaught exception: ${err?.stack}\n${origin}`)
        })

        // 执行启动命令
        const cmds = config.settings.startupCommands;
        if (cmds?.length) {
            for (let i = 0; i < cmds.length; i++) {
                const cmd = cmds[i];
                const preview = cmd.includes('\n') ? cmd.split('\n')[0] + '...' : cmd;
                logger.info(`Startup command [${i + 1}/${cmds.length}]: ${preview}`);
                try {
                    execSync(cmd, { stdio: 'inherit' });
                } catch (e: any) {
                    logger.error(`Startup command [${i + 1}] failed: ${e?.message ?? e}`);
                }
            }
        }

        setMaxImageSize(config.settings.maxImageSize);
        await database.init()
        initGlobalAgentToolService()
        initGlobalSkillService()
        await channelManager.init()
        await httpServer.start()
        await schedulerService.start()
        await heartbeatService.start()

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
        log4js.shutdown(() => {
            process.exit(1)
        })
    }
}
