#!/usr/bin/env node
import * as fs from "fs";
if (fs.existsSync(__filename + ".map")) process.setSourceMapsEnabled?.(true);
import { Command } from "commander";
import { spawn, execSync } from "child_process";
import { fetchLatestRelease, compareSemver } from "sbot.commons";
import { config } from "./Core/Config";
import { registerCommands, applyPort } from "./Cli/commands";

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
    const { agendaTriggerEnginePool, agendaStartupExtractAll } = await import("./Agenda");
    const { startupExtractAll: memoryStartupExtractAll } = await import("./Memory/MemoryServicePool");
    const { heartbeatService } = await import("./Heartbeat/HeartbeatService");
    const { tunnelService } = await import("./Tunnel");

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
        await agendaTriggerEnginePool.startAll()
        memoryStartupExtractAll()
        agendaStartupExtractAll()
        await heartbeatService.start()
        await tunnelService.startAll(config.getHttpPort())

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
