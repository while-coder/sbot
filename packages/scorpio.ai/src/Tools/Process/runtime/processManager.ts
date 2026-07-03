import { type ChildProcess } from 'child_process';
import { type Writable } from 'stream';
import { GlobalLoggerService } from '../../../Logger';
import { createTextContent, type MCPToolResult } from '../../Core';
import {
    appendOutputBuffer,
    createOutputBuffer,
    drainOutputBuffer,
    formatProcessExit,
    getCurrentShell,
    hasBufferedOutput,
    killProcessTree,
    LimitedOutputBuffer,
    ProcessShell,
    spawnRuntimeProcess,
} from './process';

const logger = GlobalLoggerService.getLogger('Tools/Process/runtime/processManager');

const MAX_SESSIONS = 32;
const IDLE_TIMEOUT_MS = 10 * 60_000;
const YIELD_MIN_MS = 250;
const YIELD_MAX_MS = 30_000;
const GRACE_DRAIN_MS = 150;
const REAPER_INTERVAL_MS = 60_000;

export interface ManagedProcessResult {
    processId?: number;
    running:    boolean;
    exitCode?:  number | null;
    signal?:    string | null;
    stdout:     string;
    stderr:     string;
    truncated?: boolean;
    note?:      string;
    stdinOpen?: boolean;
    isError?:   boolean;
}

export function formatProcessResult(result: ManagedProcessResult): MCPToolResult {
    const parts: string[] = [];
    if (result.stdout) parts.push(result.stdout.trimEnd());
    if (result.stderr) parts.push(`stderr:\n${result.stderr.trimEnd()}`);
    if (result.truncated) parts.push('Output exceeded the unread buffer limit; some output was discarded.');
    if (result.running) {
        let note = `Process is still running.\nprocessId: ${result.processId}\nUse read_process with this processId to read more output.`;
        if (result.stdinOpen) note += '\nUse write_process with this processId to send more stdin.';
        if (result.note && !result.note.startsWith('[background]')) note = `${result.note}\n\n${note}`;
        parts.push(note);
    } else if (result.note) {
        parts.push(result.note);
    }
    if (parts.length === 0) parts.push(result.running ? `Process is still running.\nprocessId: ${result.processId}` : 'No output.');

    const isError = result.isError || (!result.running && (
        result.note?.startsWith('No such process') ||
        result.signal != null ||
        result.exitCode === -1 ||
        (result.exitCode != null && result.exitCode !== 0) ||
        result.truncated
    ));

    return { content: [createTextContent(parts.join('\n\n'))], isError: isError || undefined };
}

type CleanupFn = () => void | Promise<void>;

interface ProcSession {
    id:         number;
    proc:       ChildProcess;
    stdout:     LimitedOutputBuffer;
    stderr:     LimitedOutputBuffer;
    exited:     boolean;
    exitCode:   number | null;
    exitSignal: NodeJS.Signals | null;
    stdinOpen:  boolean;
    lastUsed:   number;
    waiters:    Array<() => void>;
    cleanup?:   CleanupFn;
}

export class ProcessManager {
    private sessions = new Map<number, ProcSession>();
    private nextProcessId = 1;
    private reaper?: NodeJS.Timeout;

    async exec(command: string, cwd: string, yieldMs: number | undefined, stdin?: string, interactive = false): Promise<ManagedProcessResult> {
        return this.start(command, [], cwd, yieldMs, getCurrentShell(), stdin, undefined, interactive);
    }

    async runProgram(file: string, args: string[], cwd: string, yieldMs: number | undefined, stdin?: string, cleanup?: CleanupFn, interactive = false): Promise<ManagedProcessResult> {
        return this.start(file, args, cwd, yieldMs, false, stdin, cleanup, interactive);
    }

    async readProcess(processId: number, yieldMs: number | undefined): Promise<ManagedProcessResult> {
        const session = this.sessions.get(processId);
        if (!session) {
            return { running: false, stdout: '', stderr: '', note: `No such process: ${processId} (it may have exited and been reclaimed)` };
        }
        session.lastUsed = Date.now();

        const collected = await this.collectOutput(session, this.clampYield(yieldMs), true);

        if (session.exited) {
            this.sessions.delete(processId);
            this.cleanup(session);
            return {
                running: false,
                exitCode: session.exitCode,
                signal: session.exitSignal,
                ...collected,
                note: formatProcessExit(session.exitCode, session.exitSignal),
            };
        }
        return {
            processId,
            running: true,
            stdinOpen: session.stdinOpen,
            ...collected,
            note: `[background] processId=${processId} still running`,
        };
    }

    async writeProcess(processId: number, stdin: string, close: boolean): Promise<ManagedProcessResult> {
        const session = this.sessions.get(processId);
        if (!session) {
            return { running: false, stdout: '', stderr: '', note: `No such process: ${processId} (it may have exited and been reclaimed)`, isError: true };
        }
        session.lastUsed = Date.now();

        if (session.exited) {
            this.sessions.delete(processId);
            this.cleanup(session);
            const collected = drainBoth(session, true);
            return {
                running: false,
                exitCode: session.exitCode,
                signal: session.exitSignal,
                ...collected,
                note: formatProcessExit(session.exitCode, session.exitSignal),
                isError: true,
            };
        }

        const procStdin = session.proc.stdin;
        if (!session.stdinOpen || !procStdin || procStdin.destroyed || procStdin.writableEnded) {
            session.stdinOpen = false;
            return {
                processId,
                running: true,
                stdout: '',
                stderr: '',
                note: `Cannot write stdin to process ${processId}; start it with mode="background" and interactive=true to use write_process.`,
                isError: true,
            };
        }

        try {
            if (stdin) await writeStdin(procStdin, stdin);
            if (close) {
                procStdin.end();
                session.stdinOpen = false;
            }
        } catch (e: any) {
            session.stdinOpen = false;
            return {
                processId,
                running: !session.exited,
                stdout: '',
                stderr: '',
                note: `Failed to write stdin to process ${processId}: ${e?.message ?? e}`,
                isError: true,
            };
        }

        return {
            processId,
            running: true,
            stdinOpen: session.stdinOpen,
            stdout: '',
            stderr: '',
            note: close ? `Wrote stdin to process ${processId} and closed stdin.` : `Wrote stdin to process ${processId}.`,
        };
    }

    async kill(processId: number): Promise<boolean> {
        const session = this.sessions.get(processId);
        if (!session) return false;
        await killProcessTree(session.proc, () => session.exited);
        this.sessions.delete(processId);
        this.cleanup(session);
        return true;
    }

    private async start(
        file: string,
        args: string[],
        cwd: string,
        yieldMs: number | undefined,
        shell: ProcessShell,
        stdin?: string,
        cleanup?: CleanupFn,
        interactive = false,
    ): Promise<ManagedProcessResult> {
        const proc = spawnRuntimeProcess(file, args, { cwd, shell, stdin, keepStdinOpen: interactive });

        const id = this.nextProcessId++;
        const session: ProcSession = {
            id, proc,
            stdout: createOutputBuffer(),
            stderr: createOutputBuffer(),
            exited: false, exitCode: null, exitSignal: null,
            stdinOpen: interactive,
            lastUsed: Date.now(),
            waiters: [],
            cleanup,
        };

        let spawnError: string | null = null;
        proc.once('error', (err: Error) => {
            spawnError = err.message;
            session.exited = true;
            session.stdinOpen = false;
            this.cleanup(session);
            this.wake(session);
        });

        this.wireStreams(session);
        this.register(session);

        const collected = await this.collectOutput(session, this.clampYield(yieldMs), false);

        if (spawnError) {
            this.sessions.delete(id);
            this.cleanup(session);
            return { running: false, exitCode: -1, stdout: '', stderr: '', note: `Error: ${spawnError}` };
        }

        if (session.exited) {
            this.sessions.delete(id);
            this.cleanup(session);
            return {
                running: false,
                exitCode: session.exitCode,
                signal: session.exitSignal,
                ...collected,
                note: formatProcessExit(session.exitCode, session.exitSignal),
            };
        }
        return {
            processId: id,
            running: true,
            stdinOpen: session.stdinOpen,
            ...collected,
            note: `[background] processId=${id} still running - use read_process to read more output`,
        };
    }

    private wake(session: ProcSession): void {
        const waiters = session.waiters;
        session.waiters = [];
        for (const w of waiters) w();
    }

    private cleanup(session: ProcSession): void {
        const cleanup = session.cleanup;
        if (!cleanup) return;
        session.cleanup = undefined;
        Promise.resolve()
            .then(cleanup)
            .catch((e) => logger?.error(`background session cleanup failed: ${e?.message ?? e}`));
    }

    private wireStreams(session: ProcSession): void {
        session.proc.stdout?.on('data', (chunk: Buffer) => { appendOutputBuffer(session.stdout, chunk); this.wake(session); });
        session.proc.stderr?.on('data', (chunk: Buffer) => { appendOutputBuffer(session.stderr, chunk); this.wake(session); });
        session.proc.once('exit', (code, signal) => {
            session.exited = true;
            session.exitCode = code;
            session.exitSignal = signal;
            session.stdinOpen = false;
            this.cleanup(session);
            this.wake(session);
        });
    }

    private register(session: ProcSession): void {
        if (this.sessions.size >= MAX_SESSIONS) {
            const victims = [...this.sessions.values()].sort((a, b) => {
                if (a.exited !== b.exited) return a.exited ? -1 : 1;
                return a.lastUsed - b.lastUsed;
            });
            const victim = victims[0];
            if (victim) {
                this.sessions.delete(victim.id);
                void killProcessTree(victim.proc, () => victim.exited).finally(() => this.cleanup(victim));
                logger?.info(`pruned background session ${victim.id} to stay under ${MAX_SESSIONS}`);
            }
        }
        this.sessions.set(session.id, session);
        this.ensureReaper();
    }

    private async collectOutput(session: ProcSession, yieldMs: number, returnOnData: boolean): Promise<{ stdout: string; stderr: string; truncated?: boolean }> {
        const deadline = Date.now() + yieldMs;

        for (;;) {
            if (returnOnData && (hasBufferedOutput(session.stdout) || hasBufferedOutput(session.stderr))) {
                return drainBoth(session, false);
            }
            if (session.exited) {
                await delay(GRACE_DRAIN_MS);
                return drainBoth(session, true);
            }
            const remaining = deadline - Date.now();
            if (remaining <= 0) return drainBoth(session, false);

            await new Promise<void>((resolve) => {
                let done = false;
                const finish = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
                const timer = setTimeout(finish, remaining);
                session.waiters.push(finish);
            });
        }
    }

    private clampYield(ms: number | undefined): number {
        const v = typeof ms === 'number' && Number.isFinite(ms) ? ms : YIELD_MIN_MS;
        return Math.min(YIELD_MAX_MS, Math.max(YIELD_MIN_MS, v));
    }

    private ensureReaper(): void {
        if (this.reaper) return;
        this.reaper = setInterval(() => {
            const now = Date.now();
            for (const [id, s] of this.sessions) {
                const idle = now - s.lastUsed > IDLE_TIMEOUT_MS;
                if (idle) {
                    this.sessions.delete(id);
                    if (!s.exited) void killProcessTree(s.proc, () => s.exited).finally(() => this.cleanup(s));
                    else this.cleanup(s);
                }
            }
            if (this.sessions.size === 0 && this.reaper) {
                clearInterval(this.reaper);
                this.reaper = undefined;
            }
        }, REAPER_INTERVAL_MS);
        this.reaper.unref?.();
    }
}

function drainBoth(session: ProcSession, final: boolean): { stdout: string; stderr: string; truncated?: boolean } {
    const out = drainOutputBuffer(session.stdout, final);
    const err = drainOutputBuffer(session.stderr, final);
    const truncated = out.overflowed || err.overflowed;
    return { stdout: out.text, stderr: err.text, truncated: truncated || undefined };
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function writeStdin(stdin: Writable, chunk: string): Promise<void> {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error | null) => {
            if (settled) return;
            settled = true;
            stdin.off('error', onError);
            if (error) reject(error);
            else resolve();
        };
        const onError = (error: Error) => finish(error);
        stdin.once('error', onError);
        stdin.write(chunk, 'utf8', finish);
    });
}

export const processManager = new ProcessManager();
