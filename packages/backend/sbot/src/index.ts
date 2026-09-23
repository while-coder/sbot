#!/usr/bin/env node
import * as fs from "fs";
if (fs.existsSync(__filename + ".map")) process.setSourceMapsEnabled?.(true);
import { enableCompileCache } from "node:module";
import { Command } from "commander";
import { spawn, execSync } from "child_process";
import { fetchLatestRelease, compareSemver } from "@sbot/shared";
import { config } from "./Core/Config";
import { registerCommands, applyPort } from "./Cli/commands";
import { initializeProcessLog, setProcessExitReason } from "./Cli/ProcessLog";

// V8 编译缓存（node >= 22.1）：二次启动免重复解析编译模块，显著缩短冷启动；
// 缓存按文件内容与 node 版本自动失效。放最前，让后续所有动态 import 都吃到缓存
try {
    enableCompileCache(config.getConfigPath("cache/compile", true));
} catch {}

const program = new Command();
program
    .name('sbot')
    .description(config.pkg.description)
    .option('-v, --version', '显示版本号并检查更新')
    .option('-p, --port <port>', 'HTTP server port')
    .option('-d, --daemon', '后台运行');

registerCommands(program);

// 默认行为：启动服务
program
    .action(async (options: { port?: string; daemon?: boolean; version?: boolean }) => {
        if (options.version) {
            const currentVer = config.pkg.version;
            console.log(`sbot v${currentVer}`);
            try {
                const release = await fetchLatestRelease();
                if (release && compareSemver(currentVer, release.tag) < 0) {
                    console.log(`最新版: ${release.tag}, 可通过 sbot update 升级`);
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
                windowsHide: true,
            });
            child.unref();
            console.log(`sbot 已在后台启动 (PID: ${child.pid})`);
            return;
        }
        if (options.port) {
            applyPort(options.port, msg => console.warn(msg));
        }
        initializeProcessLog();
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
    const { agendaTriggerEnginePool, agendaStartupExtractAll } = await import("./Agenda");
    const { startupExtractAll: memoryStartupExtractAll } = await import("./Memory/MemoryServicePool");
    const { heartbeatService } = await import("./Heartbeat/HeartbeatService");
    const { tunnelService } = await import("./Tunnel");

    const logger = LoggerService.getLogger('index.ts');
    logger.info("=========================Starting===========================")
    const shutdownForSignal = (signal: NodeJS.Signals) => {
        setProcessExitReason(`signal_${signal}`, true);
        logger.info(`Shutdown requested via ${signal}`);
        void httpServer.shutdown();
    };
    try {
        process.on('uncaughtException', function(err, origin) {
            logger.error(`Uncaught exception: ${err?.stack}\n${origin}`)
        })
        process.once('SIGINT', () => shutdownForSignal('SIGINT'));
        process.once('SIGTERM', () => shutdownForSignal('SIGTERM'));
        if (process.platform !== 'win32') {
            process.once('SIGHUP', () => shutdownForSignal('SIGHUP'));
        }

        // 执行启动命令
        const cmds = config.settings.startupCommands;
        if (cmds?.length) {
            for (let i = 0; i < cmds.length; i++) {
                const cmd = cmds[i];
                const preview = cmd.includes('\n') ? cmd.split('\n')[0] + '...' : cmd;
                logger.info(`Startup command [${i + 1}/${cmds.length}]: ${preview}`);
                try {
                    execSync(cmd, { stdio: 'inherit', windowsHide: true });
                } catch (e: any) {
                    logger.error(`Startup command [${i + 1}] failed: ${e?.message ?? e}`);
                }
            }
        }

        setMaxImageSize(config.settings.maxImageSize);
        await database.init()
        initGlobalAgentToolService()
        initGlobalSkillService()
        // 先开 HTTP 端口（桌面启动器/webui 以端口就绪为启动完成信号），
        // channel/agenda/memory 等重初始化放到之后，缩短启动等待
        await httpServer.start()
        await channelManager.init()
        await agendaTriggerEnginePool.startAll()
        memoryStartupExtractAll()
        agendaStartupExtractAll()
        await heartbeatService.start()
        await tunnelService.startAll(config.getHttpPort())

        logger.info("=========================Started successfully=============")
    } catch (e) {
        setProcessExitReason("startup_failure", false);
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
