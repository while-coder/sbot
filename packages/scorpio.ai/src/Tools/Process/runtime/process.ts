import fs from 'fs';
import path from 'path';
import { execSync, spawn, type ChildProcess } from 'child_process';
import os from 'os';
import { setTimeout as sleep } from 'timers/promises';
import { StringDecoder } from 'string_decoder';
import { GlobalLoggerService } from '../../../Logger';

const logger = GlobalLoggerService.getLogger('Tools/Process/runtime/process');

export const MAX_OUTPUT_BYTES = 256 * 1024;

const SIGKILL_TIMEOUT_MS = 800;
const SHELL_BLACKLIST = new Set(['fish', 'nu']);
const PROBE_TIMEOUT_MS = 2_000;

export type ProcessShell = string | false;

export interface LimitedOutputBuffer {
    chunks:   Buffer[];
    bytes:    number;
    overflow: boolean;
    decoder:  StringDecoder;
}

export interface OutputDrain {
    text:       string;
    overflowed: boolean;
}

const QUIET_ENV = {
    CI:                   '1',
    NO_COLOR:             '1',
    FORCE_COLOR:          '0',
    NPM_CONFIG_PROGRESS:  'false',
    PIP_PROGRESS_BAR:     'off',
    PYTHONUNBUFFERED:     '1',
    GIT_TERMINAL_PROMPT:  '0',
    GIT_ASKPASS:          'echo',
    SSH_ASKPASS:          'echo',
    GCM_INTERACTIVE:      'Never',
    DEBIAN_FRONTEND:      'noninteractive',
};

const SECRET_ENV_RE = /KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|AUTH|SESSION/i;

let safeEnv: NodeJS.ProcessEnv | undefined;
let currentShell: string | undefined;

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

export function getCurrentShell(): string {
    if (currentShell !== undefined) return currentShell;

    if (process.platform !== 'win32') {
        const s = process.env.SHELL;
        currentShell = (s && !SHELL_BLACKLIST.has(path.basename(s))) ? s : '/bin/bash';
        logger?.info(`using shell: ${currentShell}`);
        return currentShell;
    }

    // Windows: $SHELL 可能是 unix 风格路径（WSL/Cygwin 残留），必须确认文件真实存在。
    const envShell = process.env.SHELL;
    if (envShell && !SHELL_BLACKLIST.has(path.win32.basename(envShell))) {
        try {
            if (fs.existsSync(envShell)) {
                currentShell = envShell; logger?.info(`using shell: ${currentShell}`); return currentShell;
            }
        } catch { /* ignore */ }
    }
    if (process.env.SBOT_BASH_PATH && fs.existsSync(process.env.SBOT_BASH_PATH)) {
        currentShell = process.env.SBOT_BASH_PATH; logger?.info(`using shell: ${currentShell}`); return currentShell;
    }

    // 直接探测常见 git-bash 路径，避免 `where git` 在 PATH 含慢盘时同步阻塞主线程。
    const candidates: (string | undefined)[] = [
        process.env.PROGRAMFILES         && path.join(process.env.PROGRAMFILES,        'Git', 'bin', 'bash.exe'),
        process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)']!, 'Git', 'bin', 'bash.exe'),
        process.env.PROGRAMW6432         && path.join(process.env.PROGRAMW6432,        'Git', 'bin', 'bash.exe'),
        process.env.LOCALAPPDATA         && path.join(process.env.LOCALAPPDATA,        'Programs', 'Git', 'bin', 'bash.exe'),
    ];
    for (const p of candidates) {
        if (!p) continue;
        try { if (fs.existsSync(p)) { currentShell = p; logger?.info(`using shell: ${currentShell}`); return currentShell; } } catch { /* ignore */ }
    }

    currentShell = process.env.COMSPEC || 'cmd.exe';
    logger?.info(`using shell: ${currentShell}`);
    return currentShell;
}

// 进程启动时一次性快照 process.env，过滤敏感变量再合并 QUIET_ENV。
// 若将来需要热更新 env，请改成基于版本号失效的缓存。
export function getChildProcessEnv(): NodeJS.ProcessEnv {
    if (safeEnv) return safeEnv;
    const filtered: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) {
        if (v === undefined) continue;
        if (SECRET_ENV_RE.test(k)) continue;
        filtered[k] = v;
    }
    safeEnv = { ...filtered, ...QUIET_ENV };
    return safeEnv;
}

export function spawnRuntimeProcess(
    file: string,
    args: string[],
    opts: { cwd: string; shell: ProcessShell; stdin?: string },
): ChildProcess {
    const proc = spawn(file, args, {
        shell:       opts.shell,
        cwd:         opts.cwd,
        env:         getChildProcessEnv(),
        stdio:       [opts.stdin !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        detached:    process.platform !== 'win32',
        windowsHide: true,
    });

    writeProcessStdin(proc, opts.stdin);
    return proc;
}

export function writeProcessStdin(proc: ChildProcess, stdin: string | undefined): void {
    if (stdin === undefined || !proc.stdin) return;
    proc.stdin.on('error', () => { /* ignore EPIPE */ });
    proc.stdin.end(stdin, 'utf8');
}

export function createOutputBuffer(): LimitedOutputBuffer {
    return { chunks: [], bytes: 0, overflow: false, decoder: new StringDecoder('utf8') };
}

export function hasBufferedOutput(buf: LimitedOutputBuffer): boolean {
    return buf.bytes > 0 || buf.overflow;
}

export function appendOutputBuffer(buf: LimitedOutputBuffer, chunk: Buffer): void {
    if (buf.overflow) return;
    const remain = MAX_OUTPUT_BYTES - buf.bytes;
    if (chunk.length >= remain) {
        if (remain > 0) buf.chunks.push(chunk.subarray(0, remain));
        buf.bytes    = MAX_OUTPUT_BYTES;
        buf.overflow = true;
        return;
    }
    buf.chunks.push(chunk);
    buf.bytes += chunk.length;
}

export function drainOutputBuffer(buf: LimitedOutputBuffer, final: boolean): OutputDrain {
    const overflowed = buf.overflow;
    const merged = Buffer.concat(buf.chunks, buf.bytes);
    const text = buf.decoder.write(merged) + (final || overflowed ? buf.decoder.end() : '');

    if (final || overflowed) buf.decoder = new StringDecoder('utf8');
    buf.chunks = [];
    buf.bytes = 0;
    buf.overflow = false;

    return { text, overflowed };
}

export function formatProcessExit(exitCode: number | null, signal: NodeJS.Signals | null): string {
    if (signal) return `Process terminated by signal ${signal}`;
    return `Process exited with code ${exitCode ?? -1}`;
}

export function validatePath(filePath: string): { valid: boolean; error?: string; absolutePath?: string } {
    if (!filePath || typeof filePath !== 'string') {
        return { valid: false, error: 'Path is empty' };
    }
    if (!path.isAbsolute(filePath)) {
        return { valid: false, error: `Path must be absolute: ${filePath}` };
    }
    return { valid: true, absolutePath: path.normalize(filePath) };
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    p.catch(() => { /* 防止 race 失败方触发 unhandledRejection */ });
    return Promise.race([
        p,
        new Promise<T>((_, reject) => {
            timer = setTimeout(() => reject(Object.assign(new Error(`${label} timed out (${ms} ms)`), { code: 'ETIMEDOUT' })), ms);
        }),
    ]).finally(() => { if (timer) clearTimeout(timer); });
}

export async function resolveWorkingDir(workingDir: string | undefined): Promise<{ cwd?: string; error?: string }> {
    if (!workingDir) return { error: 'workingDir is required' };

    const v = validatePath(workingDir);
    if (!v.valid) return { error: v.error };

    const cwd = v.absolutePath!;
    try {
        const stat = await withTimeout(fs.promises.stat(cwd), PROBE_TIMEOUT_MS, `stat ${cwd}`);
        if (!stat.isDirectory()) return { error: `Path is not a directory: ${cwd}` };
        return { cwd };
    } catch (e: any) {
        if (e?.code === 'ENOENT')    return { error: `Working directory not found: ${cwd}` };
        if (e?.code === 'ETIMEDOUT') return { error: e.message };
        return { error: `Failed to check working directory: ${e?.message ?? e}` };
    }
}

export async function killProcessTree(proc: ChildProcess, isExited: () => boolean): Promise<void> {
    const pid = proc.pid;
    if (!pid || isExited()) return;

    if (process.platform === 'win32') {
        await new Promise<void>((resolve) => {
            const killer = spawn('taskkill', ['/pid', String(pid), '/f', '/t'], { stdio: 'ignore', windowsHide: true });
            killer.once('exit', () => resolve());
            killer.once('error', () => resolve());
        });
        return;
    }

    try {
        process.kill(-pid, 'SIGTERM');
        await sleep(SIGKILL_TIMEOUT_MS);
        if (!isExited()) process.kill(-pid, 'SIGKILL');
    } catch {
        try { proc.kill('SIGTERM'); } catch { /* ignore */ }
        await sleep(SIGKILL_TIMEOUT_MS);
        if (!isExited()) { try { proc.kill('SIGKILL'); } catch { /* ignore */ } }
    }
}
