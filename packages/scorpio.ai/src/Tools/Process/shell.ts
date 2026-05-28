import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';
import { GlobalLoggerService } from '../../Logger';

const logger = GlobalLoggerService.getLogger('Tools/Process');

const SHELL_BLACKLIST = new Set(['fish', 'nu']);
const PROBE_TIMEOUT_MS = 2_000;

export function isCommandAvailable(interpreter: string): boolean {
    try {
        execSync(os.platform() === 'win32' ? `where ${interpreter}` : `which ${interpreter}`, {
            stdio:   'ignore',
            timeout: PROBE_TIMEOUT_MS,
        });
        return true;
    } catch {
        return false;
    }
}

let _shell: string | undefined;

export function resolveShell(): string {
    if (_shell !== undefined) return _shell;

    if (process.platform !== 'win32') {
        const s = process.env.SHELL;
        _shell = (s && !SHELL_BLACKLIST.has(path.basename(s))) ? s : '/bin/bash';
        logger?.info(`using shell: ${_shell}`);
        return _shell;
    }

    // Windows: $SHELL 可能是 unix 风格路径（WSL/Cygwin 残留），必须确认文件真实存在。
    const envShell = process.env.SHELL;
    if (envShell && !SHELL_BLACKLIST.has(path.win32.basename(envShell))) {
        try {
            if (fs.existsSync(envShell)) {
                _shell = envShell; logger?.info(`using shell: ${_shell}`); return _shell;
            }
        } catch { /* ignore */ }
    }
    if (process.env.SBOT_BASH_PATH && fs.existsSync(process.env.SBOT_BASH_PATH)) {
        _shell = process.env.SBOT_BASH_PATH; logger?.info(`using shell: ${_shell}`); return _shell;
    }

    // 直接探测常见 git-bash 路径，避免 `where git` 在 PATH 含慢盘时同步阻塞主线程。
    const candidates: (string | undefined)[] = [
        process.env.PROGRAMFILES        && path.join(process.env.PROGRAMFILES,        'Git', 'bin', 'bash.exe'),
        process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)']!, 'Git', 'bin', 'bash.exe'),
        process.env.PROGRAMW6432        && path.join(process.env.PROGRAMW6432,        'Git', 'bin', 'bash.exe'),
        process.env.LOCALAPPDATA        && path.join(process.env.LOCALAPPDATA,        'Programs', 'Git', 'bin', 'bash.exe'),
    ];
    for (const p of candidates) {
        if (!p) continue;
        try { if (fs.existsSync(p)) { _shell = p; logger?.info(`using shell: ${_shell}`); return _shell; } } catch { /* ignore */ }
    }

    _shell = process.env.COMSPEC || 'cmd.exe';
    logger?.info(`using shell: ${_shell}`);
    return _shell;
}

// 模块加载时 eager 解析一次，避免首条命令承担同步探测成本。
resolveShell();
