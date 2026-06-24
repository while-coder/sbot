import { Command } from "commander";
import { spawn } from "child_process";
import { fetchLatestRelease, compareSemver, NPM_PACKAGE } from "sbot.commons";
import { enableAutoStart, disableAutoStart, isAutoStartEnabled } from "../Core/AutoStart";
import { config } from "../Core/Config";
import { isServiceRunning, shutdownService, delay } from "./serviceClient";

/** 校验端口并保存；非法端口时回调 onInvalid */
export function applyPort(portStr: string, onInvalid: (msg: string) => void): void {
    const port = Number(portStr);
    if (!Number.isInteger(port) || port <= 0 || port >= 65536) {
        onInvalid(`Invalid port: ${portStr}`);
        return;
    }
    config.setHttpPort(port);
}

/** 注册所有 CLI 子命令（默认启动行为仍由入口 index.ts 处理） */
export function registerCommands(program: Command): void {
    // 关闭服务命令
    program
        .command('stop')
        .description('关闭正在运行的 sbot 服务')
        .action(async () => {
            const port = config.getHttpPort();
            if (await shutdownService(port)) {
                console.log('sbot 服务正在关闭...');
            } else {
                console.error('sbot 服务未运行或关闭失败');
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
                isServiceRunning(port),
                fetchLatestRelease(),
            ]);
            const startup = isAutoStartEnabled();
            const currentVer = config.pkg.version;
            let versionInfo = currentVer;
            if (release && compareSemver(currentVer, release.tag) < 0) {
                versionInfo += ` (最新版: ${release.tag}, 可通过 sbot update 升级)`;
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

    // 更新到最新版本
    program
        .command('update')
        .description('更新 sbot 到最新版本')
        .option('-f, --force', '即使已是最新版本也强制重新安装')
        .action(async (options: { force?: boolean }) => {
            const currentVer = config.pkg.version;
            console.log(`当前版本: v${currentVer}`);
            const release = await fetchLatestRelease();
            if (!release) {
                console.error('无法获取最新版本信息，请检查网络连接');
                process.exit(1);
            }
            const cmp = compareSemver(currentVer, release.tag);
            if (cmp >= 0 && !options.force) {
                console.log('已是最新版本，无需更新');
                return;
            }
            if (cmp < 0) {
                console.log(`发现新版本: ${release.tag}，开始更新...`);
            } else {
                console.log(`强制重新安装 ${release.tag}...`);
            }
            // 若服务正在运行，先关闭再升级，避免文件占用导致安装失败
            const port = config.getHttpPort();
            if (await isServiceRunning(port)) {
                console.log('检测到 sbot 服务正在运行，正在关闭...');
                const stopped = await shutdownService(port);
                if (!stopped) {
                    console.error('关闭服务失败，请手动执行 sbot stop 后重试');
                    process.exit(1);
                }
                // 等待端口释放、进程退出
                for (let i = 0; i < 10; i++) {
                    await delay(500);
                    if (!(await isServiceRunning(port))) break;
                }
                console.log('服务已关闭');
            }
            const child = spawn('npm', ['install', '-g', `${NPM_PACKAGE}@latest`], {
                stdio: 'inherit',
                shell: true,
            });
            child.on('error', (err) => {
                console.error(`更新失败: ${err.message}`);
                process.exit(1);
            });
            child.on('exit', (code) => {
                if (code === 0) {
                    console.log(`更新完成，sbot 已升级到 ${release.tag}`);
                    console.log('可执行 sbot（或 sbot -d 后台运行）启动新版本');
                } else {
                    console.error(`更新失败，npm 退出码: ${code}`);
                    process.exit(code ?? 1);
                }
            });
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
}
