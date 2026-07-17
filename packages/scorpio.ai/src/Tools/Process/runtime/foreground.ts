import { GlobalLoggerService } from '../../../Logger';
import { createTextContent, MCPToolResult } from '../../Core';
import { formatError } from '../../../Core';
import {
    appendOutputBuffer,
    createOutputBuffer,
    drainOutputBuffer,
    formatProcessExit,
    getCurrentShell,
    killProcessTree,
    MAX_OUTPUT_BYTES,
    ProcessShell,
    spawnRuntimeProcess,
} from './process';

const logger = GlobalLoggerService.getLogger('Tools/Process/runtime/foreground');

const IO_DRAIN_TIMEOUT_MS = 2_000;

export { MAX_OUTPUT_BYTES };

interface RunOptions {
    cwd:     string;
    timeout: number;
    label:   string;
    /** 传字符串走 shell（解析 &&、管道、重定向等）；传 false 直接 exec，args 不经 shell。 */
    shell:   ProcessShell;
    /** 写入子进程 stdin 的字符串；写完即 end，子进程读到 EOF。未传则 stdin 关闭。 */
    stdin?:  string;
}

/**
 * 子进程通用执行器。stdout/stderr 用 Buffer 累积，finish 时一次性解码以正确处理多字节边界；
 * 超时、输出溢出、非 0 退出码、spawn error 都会以 isError=true 返回。
 */
async function runProcess(file: string, args: string[], opts: RunOptions): Promise<MCPToolResult> {
    const { cwd, timeout, label, shell, stdin } = opts;

    return new Promise<MCPToolResult>((resolve) => {
        const outBuf = createOutputBuffer();
        const errBuf = createOutputBuffer();
        let timedOut = false;
        let exited = false;
        let settled = false;

        // detached: !win32 —— 让子进程成为新进程组组长，killTree 才能 kill -pgid 杀到孙子进程。
        // windowsHide: true —— Windows 下不弹出控制台窗口，静默执行。
        // stdin 由 spawnRuntimeProcess 一次写完并关闭 fd；未传 stdin 时直接关闭输入端。
        const proc = spawnRuntimeProcess(file, args, { cwd, shell, stdin });

        const kill = () => killProcessTree(proc, () => exited);

        proc.stdout?.on('data', (chunk: Buffer) => appendOutputBuffer(outBuf, chunk));
        proc.stderr?.on('data', (chunk: Buffer) => appendOutputBuffer(errBuf, chunk));

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
            const outDrain = drainOutputBuffer(outBuf, true);
            const errDrain = drainOutputBuffer(errBuf, true);
            const out = outDrain.text.trim();
            const err = errDrain.text.trim();
            if (out) parts.push(createTextContent(out));
            if (err) parts.push(createTextContent(`stderr:\n${err}`));

            const outOverflow = outDrain.overflowed;
            const errOverflow = errDrain.overflowed;

            const isError = timedOut || outOverflow || errOverflow || forcedDrainTimeout ||
                            (exitCode !== null && exitCode !== 0) ||
                            exitSignal !== null;
            if (timedOut)                                  parts.push(createTextContent(`Command timed out after ${timeout} ms`));
            else if (outOverflow || errOverflow)            parts.push(createTextContent(`Output exceeded ${MAX_OUTPUT_BYTES} bytes; remaining output discarded`));
            else if (forcedDrainTimeout)                    parts.push(createTextContent(`Output streams did not close within ${IO_DRAIN_TIMEOUT_MS} ms; force-finished`));
            else if (exitCode !== null && exitCode !== 0)   parts.push(createTextContent(formatProcessExit(exitCode, null)));
            else if (exitSignal !== null)                   parts.push(createTextContent(formatProcessExit(exitCode, exitSignal)));

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
            logger?.error(`Error executing ${label}: ${formatError(error, true)}`);
            resolve({ content: [createTextContent(`Error: ${formatError(error)}`)], isError: true });
        });
    });
}

/** 执行一段 shell 脚本字符串（支持 &&、管道、重定向）。整段交给 shell 解析。 */
export function runShellCommand(command: string, cwd: string, timeout: number, label: string, stdin?: string): Promise<MCPToolResult> {
    return runProcess(command, [], { cwd, timeout, label, shell: getCurrentShell(), stdin });
}

/** 执行解释器 + 参数数组。args 直接作为 OS 层参数传递，不经 shell 解析，无引号/转义风险。 */
export function runProgram(file: string, args: string[], cwd: string, timeout: number, label: string, stdin?: string): Promise<MCPToolResult> {
    return runProcess(file, args, { cwd, timeout, label, shell: false, stdin });
}
