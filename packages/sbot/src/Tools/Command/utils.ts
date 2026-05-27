import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawn, execSync, type ChildProcess } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';
import { StringDecoder } from 'string_decoder';
import { z } from 'zod';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { LoggerService } from '../../Core/LoggerService';
import { createTextContent, createErrorResult, MCPToolResult } from 'scorpio.ai';

export const logger = LoggerService.getLogger('Tools/Command');

export const MAX_OUTPUT_BYTES = 256 * 1024;
const SIGKILL_TIMEOUT_MS = 800;
const SHELL_BLACKLIST = new Set(['fish', 'nu']);
const PROBE_TIMEOUT_MS = 2_000;
const IO_DRAIN_TIMEOUT_MS = 2_000;

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
        logger.info(`using shell: ${_shell}`);
        return _shell;
    }

    // Windows: $SHELL 可能是 unix 风格路径（WSL/Cygwin 残留），必须确认文件真实存在。
    const envShell = process.env.SHELL;
    if (envShell && !SHELL_BLACKLIST.has(path.win32.basename(envShell))) {
        try {
            if (fs.existsSync(envShell)) {
                _shell = envShell; logger.info(`using shell: ${_shell}`); return _shell;
            }
        } catch { /* ignore */ }
    }
    if (process.env.SBOT_BASH_PATH && fs.existsSync(process.env.SBOT_BASH_PATH)) {
        _shell = process.env.SBOT_BASH_PATH; logger.info(`using shell: ${_shell}`); return _shell;
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
        try { if (fs.existsSync(p)) { _shell = p; logger.info(`using shell: ${_shell}`); return _shell; } } catch { /* ignore */ }
    }

    _shell = process.env.COMSPEC || 'cmd.exe';
    logger.info(`using shell: ${_shell}`);
    return _shell;
}

// 模块加载时 eager 解析一次，避免首条命令承担同步探测成本。
resolveShell();

async function killTree(proc: ChildProcess, isExited: () => boolean): Promise<void> {
    const pid = proc.pid;
    if (!pid || isExited()) return;

    if (process.platform === 'win32') {
        await new Promise<void>((resolve) => {
            const killer = spawn('taskkill', ['/pid', String(pid), '/f', '/t'], { stdio: 'ignore' });
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

export function validatePath(filePath: string): { valid: boolean; error?: string; absolutePath?: string } {
    if (!filePath || typeof filePath !== 'string') {
        return { valid: false, error: 'Path is empty' };
    }
    if (!path.isAbsolute(filePath)) {
        return { valid: false, error: `Path must be absolute: ${filePath}` };
    }
    return { valid: true, absolutePath: path.normalize(filePath) };
}

/**
 * 给 Promise 套超时。一旦 race 输给 timeout，原 promise 之后仍可能 reject ——
 * 通过提前挂一个 noop catch 把它标记为已处理，避免 unhandledRejection。
 */
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

const QUIET_ENV = {
    CI:                   '1',
    NO_COLOR:             '1',
    FORCE_COLOR:          '0',
    NPM_CONFIG_PROGRESS:  'false',
    PIP_PROGRESS_BAR:     'off',
    PYTHONUNBUFFERED:     '1',
    // 阻止子进程弹出交互式凭据提示（git push HTTPS、ssh、apt 等）。
    GIT_TERMINAL_PROMPT:  '0',
    GIT_ASKPASS:          'echo',
    SSH_ASKPASS:          'echo',
    GCM_INTERACTIVE:      'Never',
    DEBIAN_FRONTEND:      'noninteractive',
};

const SECRET_ENV_RE = /KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|AUTH|SESSION/i;

// 进程启动时一次性快照 process.env，过滤敏感变量再合并 QUIET_ENV。
// 设计取舍：bot 运行期不会动态注入凭据，缓存一次避免每条命令都做 O(n) 过滤。
// 若将来需要热更新 env，请改成基于版本号失效的缓存。
let _safeEnv: NodeJS.ProcessEnv | undefined;
function buildChildEnv(): NodeJS.ProcessEnv {
    if (_safeEnv) return _safeEnv;
    const filtered: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) {
        if (v === undefined) continue;
        if (SECRET_ENV_RE.test(k)) continue;
        filtered[k] = v;
    }
    _safeEnv = { ...filtered, ...QUIET_ENV };
    return _safeEnv;
}

interface RunOptions {
    cwd:     string;
    timeout: number;
    label:   string;
    /** 传字符串走 shell（解析 &&、管道、重定向等）；传 false 直接 exec，args 不经 shell。 */
    shell:   string | false;
}

interface OutputBuffer {
    chunks:   Buffer[];
    bytes:    number;
    overflow: boolean;
}

function appendChunk(buf: OutputBuffer, chunk: Buffer): void {
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

// 累积阶段保留 Buffer 引用，避免反复 ConsString 拼接 / flatten 带来的 GC 压力；
// finish 时一次性 concat 后用 StringDecoder 解码全 buffer，多字节边界由 decoder 内部处理，
// 字节截断尾部不完整字符通过 decoder.end() 输出 replacement。
function decodeBuffer(buf: OutputBuffer): string {
    const merged  = Buffer.concat(buf.chunks, buf.bytes);
    const decoder = new StringDecoder('utf8');
    return decoder.write(merged) + decoder.end();
}

/**
 * 子进程通用执行器。stdout/stderr 用 Buffer 累积，finish 时一次性解码以正确处理多字节边界；
 * 超时、输出溢出、非 0 退出码、spawn error 都会以 isError=true 返回。
 */
async function runProcess(file: string, args: string[], opts: RunOptions): Promise<MCPToolResult> {
    const { cwd, timeout, label, shell } = opts;

    return new Promise<MCPToolResult>((resolve) => {
        const outBuf: OutputBuffer = { chunks: [], bytes: 0, overflow: false };
        const errBuf: OutputBuffer = { chunks: [], bytes: 0, overflow: false };
        let timedOut = false;
        let exited = false;
        let settled = false;

        // detached: !win32 —— 让子进程成为新进程组组长，killTree 才能 kill -pgid 杀到孙子进程。
        const proc = spawn(file, args, {
            shell,
            cwd,
            env: buildChildEnv(),
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: process.platform !== 'win32',
        });

        const kill = () => killTree(proc, () => exited);

        proc.stdout?.on('data', (chunk: Buffer) => appendChunk(outBuf, chunk));
        proc.stderr?.on('data', (chunk: Buffer) => appendChunk(errBuf, chunk));

        let exitCode: number | null = null;
        let exitSignal: NodeJS.Signals | null = null;

        let forcedDrainTimeout = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutTimer);
            if (drainTimer) clearTimeout(drainTimer);
            try { proc.stdout?.destroy(); } catch { /* ignore */ }
            try { proc.stderr?.destroy(); } catch { /* ignore */ }

            const parts = [];
            const out = decodeBuffer(outBuf).trim();
            const err = decodeBuffer(errBuf).trim();
            if (out) parts.push(createTextContent(out));
            if (err) parts.push(createTextContent(`stderr:\n${err}`));

            const outOverflow = outBuf.overflow;
            const errOverflow = errBuf.overflow;

            const isError = timedOut || outOverflow || errOverflow || forcedDrainTimeout ||
                            (exitCode !== null && exitCode !== 0) ||
                            exitSignal !== null;
            if (timedOut)                                  parts.push(createTextContent(`Command timed out after ${timeout} ms`));
            else if (outOverflow || errOverflow)            parts.push(createTextContent(`Output exceeded ${MAX_OUTPUT_BYTES} bytes; remaining output discarded`));
            else if (forcedDrainTimeout)                    parts.push(createTextContent(`Output streams did not close within ${IO_DRAIN_TIMEOUT_MS} ms; force-finished`));
            else if (exitCode !== null && exitCode !== 0)   parts.push(createTextContent(`Process exited with code ${exitCode}`));
            else if (exitSignal !== null)                   parts.push(createTextContent(`Process terminated by signal ${exitSignal}`));

            resolve({ content: parts, isError: isError || undefined });
        };

        let drainTimer: NodeJS.Timeout | undefined;
        const startDrainTimer = () => {
            if (drainTimer) return;
            drainTimer = setTimeout(() => { forcedDrainTimeout = true; finish(); }, IO_DRAIN_TIMEOUT_MS);
        };

        const timeoutTimer = setTimeout(() => {
            timedOut = true;
            void kill();
            startDrainTimer();
        }, timeout);

        // 'exit' 在子进程终止时立即触发，但 stdio 中可能还有未消费的 tail bytes；
        // 'close' 在 stdout/stderr 全部 drain 后才触发，是聚合输出的正确时机。
        // 若孙子进程持有 fd 导致 'close' 永远不触发，drainTimer 兜底强制收尾。
        proc.once('exit', (code, signal) => {
            exited     = true;
            exitCode   = code;
            exitSignal = signal;
            startDrainTimer();
        });
        proc.once('close', () => {
            exited = true;
            finish();
        });

        proc.once('error', (error: Error) => {
            exited = true;
            if (settled) return;
            settled = true;
            clearTimeout(timeoutTimer);
            if (drainTimer) clearTimeout(drainTimer);
            logger.error(`Error executing ${label}: ${error.message}`);
            resolve({ content: [createTextContent(`Error: ${error.message}`)], isError: true });
        });
    });
}

/** 执行一段 shell 脚本字符串（支持 &&、管道、重定向）。整段交给 shell 解析。 */
export function runShellCommand(command: string, cwd: string, timeout: number, label: string): Promise<MCPToolResult> {
    return runProcess(command, [], { cwd, timeout, label, shell: resolveShell() });
}

/** 执行解释器 + 参数数组。args 直接作为 OS 层参数传递，不经 shell 解析，无引号/转义风险。 */
export function runProgram(file: string, args: string[], cwd: string, timeout: number, label: string): Promise<MCPToolResult> {
    return runProcess(file, args, { cwd, timeout, label, shell: false });
}

export const scriptCodeSchema = z.object({
    code:       z.string().describe('Script source code to execute; written to a temp file automatically'),
    workingDir: z.string().describe('Absolute path of the working directory for the script'),
    args:       z.array(z.string()).optional().describe('Command-line arguments to pass to the script'),
    timeout:    z.number().optional().default(60000).describe('Timeout in milliseconds, default 60000 (60 s)'),
});

// ─── Script code tool factory（被 Python / PowerShell 工具复用）──────────

export interface ScriptCodeToolOptions {
    name:        string;
    description: string;
    interpreter: string;
    preArgs?:    string[];
    ext:         string;
}

export function createScriptCodeTool({ name, description, interpreter, preArgs = [], ext }: ScriptCodeToolOptions): StructuredToolInterface | null {
    if (!isCommandAvailable(interpreter)) return null;
    return new DynamicStructuredTool({
        name,
        description,
        schema: scriptCodeSchema as any,
        func: async ({ code, args = [], workingDir, timeout = 60000 }: any): Promise<MCPToolResult> => {
            // 加随机后缀防止毫秒级并发同名碰撞导致互相 unlink。
            const tmpFile = path.join(os.tmpdir(), `sbot_script_${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`);
            try {
                await fs.promises.writeFile(tmpFile, code, 'utf8');
            } catch (e: any) {
                return createErrorResult(`Failed to write temp script: ${e?.message ?? e}`);
            }

            try {
                const { cwd, error: cwdError } = await resolveWorkingDir(workingDir);
                if (cwdError) return createErrorResult(cwdError);
                return await runProgram(interpreter, [...preArgs, tmpFile, ...args], cwd!, timeout, name);
            } finally {
                try { await fs.promises.unlink(tmpFile); } catch { /* ignore */ }
            }
        },
    });
}
