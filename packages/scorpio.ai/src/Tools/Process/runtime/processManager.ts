import { spawn, type ChildProcess } from 'child_process';
import { StringDecoder } from 'string_decoder';
import { GlobalLoggerService } from '../../../Logger';
import { createTextContent, type MCPToolResult } from '../../Core';
import { getChildProcessEnv, getCurrentShell, killProcessTree, MAX_OUTPUT_BYTES } from './process';

const logger = GlobalLoggerService.getLogger('Tools/Process/runtime/processManager');

const MAX_SESSIONS = 32;
const IDLE_TIMEOUT_MS = 10 * 60_000;
const YIELD_MIN_MS = 250;
const YIELD_MAX_MS = 30_000;
const GRACE_DRAIN_MS = 150;
const REAPER_INTERVAL_MS = 60_000;

interface StreamBuffer {
    text:     string;
    bytes:    number;
    overflow: boolean;
    decoder:  StringDecoder;
}

export interface ManagedProcessResult {
    processId?: number;
    running:    boolean;
    exitCode?:  number | null;
    signal?:    string | null;
    stdout:     string;
    stderr:     string;
    truncated?: boolean;
    note?:      string;
}

export function formatProcessResult(result: ManagedProcessResult): MCPToolResult {
    const parts: string[] = [];
    if (result.stdout) parts.push(result.stdout.trimEnd());
    if (result.stderr) parts.push(`stderr:\n${result.stderr.trimEnd()}`);
    if (result.truncated) parts.push('Output exceeded the unread buffer limit; some output was discarded.');
    if (result.running) {
        parts.push(`Process is still running.\nprocessId: ${result.processId}\nUse read_process with this processId to read more output.`);
    } else if (result.note) {
        parts.push(result.note);
    }
    if (parts.length === 0) parts.push(result.running ? `Process is still running.\nprocessId: ${result.processId}` : 'No output.');

    const isError = !result.running && (
        result.note?.startsWith('No such process') ||
        result.signal != null ||
        result.exitCode === -1 ||
        (result.exitCode != null && result.exitCode !== 0) ||
        result.truncated
    );

    return { content: [createTextContent(parts.join('\n\n'))], isError: isError || undefined };
}

type CleanupFn = () => void | Promise<void>;

interface ProcSession {
    id:         number;
    proc:       ChildProcess;
    stdout:     StreamBuffer;
    stderr:     StreamBuffer;
    exited:     boolean;
    exitCode:   number | null;
    exitSignal: NodeJS.Signals | null;
    lastUsed:   number;
    waiters:    Array<() => void>;
    cleanup?:   CleanupFn;
}

export class ProcessManager {
    private sessions = new Map<number, ProcSession>();
    private nextProcessId = 1;
    private reaper?: NodeJS.Timeout;

    async exec(command: string, cwd: string, yieldMs: number | undefined, stdin?: string): Promise<ManagedProcessResult> {
        return this.start(command, [], cwd, yieldMs, getCurrentShell(), stdin);
    }

    async runProgram(file: string, args: string[], cwd: string, yieldMs: number | undefined, stdin?: string, cleanup?: CleanupFn): Promise<ManagedProcessResult> {
        return this.start(file, args, cwd, yieldMs, false, stdin, cleanup);
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
                note: exitNote(session),
            };
        }
        return {
            processId,
            running: true,
            ...collected,
            note: `[background] processId=${processId} still running`,
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
        shell: string | false,
        stdin?: string,
        cleanup?: CleanupFn,
    ): Promise<ManagedProcessResult> {
        const proc = spawn(file, args, {
            shell,
            cwd,
            env:         getChildProcessEnv(),
            stdio:       ['pipe', 'pipe', 'pipe'],
            detached:    process.platform !== 'win32',
            windowsHide: true,
        });

        if (stdin !== undefined && proc.stdin) {
            proc.stdin.on('error', () => { /* ignore EPIPE */ });
            proc.stdin.end(stdin, 'utf8');
        }

        const id = this.nextProcessId++;
        const session: ProcSession = {
            id, proc,
            stdout: createStreamBuffer(),
            stderr: createStreamBuffer(),
            exited: false, exitCode: null, exitSignal: null,
            lastUsed: Date.now(),
            waiters: [],
            cleanup,
        };

        let spawnError: string | null = null;
        proc.once('error', (err: Error) => {
            spawnError = err.message;
            session.exited = true;
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
                note: exitNote(session),
            };
        }
        return {
            processId: id,
            running: true,
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
        session.proc.stdout?.on('data', (chunk: Buffer) => { appendStream(session.stdout, chunk); this.wake(session); });
        session.proc.stderr?.on('data', (chunk: Buffer) => { appendStream(session.stderr, chunk); this.wake(session); });
        session.proc.once('exit', (code, signal) => {
            session.exited = true;
            session.exitCode = code;
            session.exitSignal = signal;
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
            if (returnOnData && (hasUnread(session.stdout) || hasUnread(session.stderr))) {
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
    const out = drainStream(session.stdout, final);
    const err = drainStream(session.stderr, final);
    const truncated = out.overflowed || err.overflowed;
    return { stdout: out.text, stderr: err.text, truncated: truncated || undefined };
}

function createStreamBuffer(): StreamBuffer {
    return { text: '', bytes: 0, overflow: false, decoder: new StringDecoder('utf8') };
}

function hasUnread(sb: StreamBuffer): boolean {
    return sb.bytes > 0 || sb.text.length > 0 || sb.overflow;
}

function appendStream(sb: StreamBuffer, chunk: Buffer): void {
    if (sb.overflow) return;
    const remain = MAX_OUTPUT_BYTES - sb.bytes;
    if (chunk.length >= remain) {
        if (remain > 0) sb.text += sb.decoder.write(chunk.subarray(0, remain));
        sb.bytes = MAX_OUTPUT_BYTES;
        sb.overflow = true;
        return;
    }
    sb.text += sb.decoder.write(chunk);
    sb.bytes += chunk.length;
}

function drainStream(sb: StreamBuffer, final: boolean): { text: string; overflowed: boolean } {
    const overflowed = sb.overflow;
    const text = sb.text + (final || overflowed ? sb.decoder.end() : '');
    if (final || overflowed) sb.decoder = new StringDecoder('utf8');
    sb.text = '';
    sb.bytes = 0;
    sb.overflow = false;
    return { text, overflowed };
}

function exitNote(session: ProcSession): string {
    if (session.exitSignal) return `Process terminated by signal ${session.exitSignal}`;
    return `Process exited with code ${session.exitCode ?? -1}`;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
}

export const processManager = new ProcessManager();
