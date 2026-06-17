import { spawn, type ChildProcess } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';
import { StringDecoder } from 'string_decoder';
import { GlobalLoggerService } from '../../Logger';
import { createTextContent, MCPToolResult } from '../types';
import { resolveShell } from './shell';

const logger = GlobalLoggerService.getLogger('Tools/Process');

export const MAX_OUTPUT_BYTES = 256 * 1024;
const SIGKILL_TIMEOUT_MS = 800;
const IO_DRAIN_TIMEOUT_MS = 2_000;

async function killTree(proc: ChildProcess, isExited: () => boolean): Promise<void> {
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
    /** 写入子进程 stdin 的字符串；写完即 end，子进程读到 EOF。未传则 stdin 关闭。 */
    stdin?:  string;
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
    const { cwd, timeout, label, shell, stdin } = opts;

    return new Promise<MCPToolResult>((resolve) => {
        const outBuf: OutputBuffer = { chunks: [], bytes: 0, overflow: false };
        const errBuf: OutputBuffer = { chunks: [], bytes: 0, overflow: false };
        let timedOut = false;
        let exited = false;
        let settled = false;

        // detached: !win32 —— 让子进程成为新进程组组长，killTree 才能 kill -pgid 杀到孙子进程。
        // windowsHide: true —— Windows 下不弹出控制台窗口，静默执行。
        const proc = spawn(file, args, {
            shell,
            cwd,
            env: buildChildEnv(),
            stdio: [stdin !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
            detached: process.platform !== 'win32',
            windowsHide: true,
        });

        if (stdin !== undefined && proc.stdin) {
            // 子进程不读 stdin 时 write 会触发 EPIPE，吞掉避免 unhandledRejection。
            proc.stdin.on('error', () => { /* ignore EPIPE */ });
            // end() 一次写完并关闭 fd，子进程读到 EOF；否则脚本可能一直等待更多输入。
            proc.stdin.end(stdin, 'utf8');
        }

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
            logger?.error(`Error executing ${label}: ${error.message}`);
            resolve({ content: [createTextContent(`Error: ${error.message}`)], isError: true });
        });
    });
}

/** 执行一段 shell 脚本字符串（支持 &&、管道、重定向）。整段交给 shell 解析。 */
export function runShellCommand(command: string, cwd: string, timeout: number, label: string, stdin?: string): Promise<MCPToolResult> {
    return runProcess(command, [], { cwd, timeout, label, shell: resolveShell(), stdin });
}

/** 执行解释器 + 参数数组。args 直接作为 OS 层参数传递，不经 shell 解析，无引号/转义风险。 */
export function runProgram(file: string, args: string[], cwd: string, timeout: number, label: string, stdin?: string): Promise<MCPToolResult> {
    return runProcess(file, args, { cwd, timeout, label, shell: false, stdin });
}
