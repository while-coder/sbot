import { spawn, type ChildProcess } from 'child_process';
import crypto from 'crypto';
import { setTimeout as sleep } from 'timers/promises';
import { StringDecoder } from 'string_decoder';
import { GlobalLoggerService } from '../../Logger';
import { createTextContent, type MCPToolResult } from '../Core';
import { resolveShell } from './shell';

const logger = GlobalLoggerService.getLogger('Tools/Process/ShellManager');

const MAX_SESSIONS = 32;
const IDLE_TIMEOUT_MS = 10 * 60_000;
const YIELD_MIN_MS = 250;
const YIELD_MAX_MS = 30_000;
const GRACE_DRAIN_MS = 150;
const REAPER_INTERVAL_MS = 60_000;

const MAX_OUTPUT_BYTES = 256 * 1024;
const SIGKILL_TIMEOUT_MS = 800;

interface StreamBuffer {
    chunks:     Buffer[];
    unread:     number;
    overflow:   boolean;
    decoder:    StringDecoder;
}

export interface BgResult {
    taskId?:    string;
    running:    boolean;
    exitCode?:  number | null;
    signal?:    string | null;
    stdout:     string;
    stderr:     string;
    truncated?: boolean;
    note?:      string;
}

export function formatBackgroundResult(result: BgResult): MCPToolResult {
    const parts: string[] = [];
    if (result.stdout) parts.push(result.stdout.trimEnd());
    if (result.stderr) parts.push(`stderr:\n${result.stderr.trimEnd()}`);
    if (result.truncated) parts.push('Output exceeded the unread buffer limit; some output was discarded.');
    if (result.running) {
        parts.push(`Task is still running.\ntaskid: ${result.taskId}\nUse read_task with this taskid to read more output.`);
    } else if (result.note) {
        parts.push(result.note);
    }
    if (parts.length === 0) parts.push(result.running ? `Task is still running.\ntaskid: ${result.taskId}` : 'No output.');

    const isError = !result.running && (
        result.note?.startsWith('No such task') ||
        result.signal != null ||
        result.exitCode === -1 ||
        (result.exitCode != null && result.exitCode !== 0) ||
        result.truncated
    );

    return { content: [createTextContent(parts.join('\n\n'))], isError: isError || undefined };
}

type CleanupFn = () => void | Promise<void>;

interface ProcSession {
    id:         string;
    proc:       ChildProcess;
    label:      string;
    stdout:     StreamBuffer;
    stderr:     StreamBuffer;
    exited:     boolean;
    exitCode:   number | null;
    exitSignal: NodeJS.Signals | null;
    lastUsed:   number;
    read:       boolean;
    waiters:    Array<() => void>;
    cleanup?:   CleanupFn;
    cleaned:    boolean;
}

interface StartOptions {
    cwd:      string;
    yieldMs?: number;
    label:    string;
    shell:    string | false;
    stdin?:   string;
    cleanup?: CleanupFn;
}

function clampYield(ms: number | undefined): number {
    const v = typeof ms === 'number' && Number.isFinite(ms) ? ms : YIELD_MIN_MS;
    return Math.min(YIELD_MAX_MS, Math.max(YIELD_MIN_MS, v));
}

class ShellManagerImpl {
    private sessions = new Map<string, ProcSession>();
    private reaper?: NodeJS.Timeout;

    async exec(command: string, cwd: string, yieldMs: number | undefined, label: string, stdin?: string): Promise<BgResult> {
        return this.start(command, [], { cwd, yieldMs, label, shell: resolveShell(), stdin });
    }

    async runProgram(file: string, args: string[], cwd: string, yieldMs: number | undefined, label: string, stdin?: string, cleanup?: CleanupFn): Promise<BgResult> {
        return this.start(file, args, { cwd, yieldMs, label, shell: false, stdin, cleanup });
    }

    async readTask(taskId: string, yieldMs: number | undefined): Promise<BgResult> {
        const session = this.sessions.get(taskId);
        if (!session) {
            return { running: false, stdout: '', stderr: '', note: `No such task: ${taskId} (it may have exited and been reclaimed)` };
        }
        session.lastUsed = Date.now();

        const collected = await this.collectOutput(session, clampYield(yieldMs), true);

        if (session.exited) {
            session.read = true;
            return {
                running: false,
                exitCode: session.exitCode,
                signal: session.exitSignal,
                ...collected,
                note: exitNote(session),
            };
        }
        return {
            taskId,
            running: true,
            ...collected,
            note: `[background] taskid=${taskId} still running`,
        };
    }

    async kill(taskId: string): Promise<boolean> {
        const session = this.sessions.get(taskId);
        if (!session) return false;
        await killTree(session.proc, () => session.exited);
        this.sessions.delete(taskId);
        this.cleanup(session);
        return true;
    }

    private async start(file: string, args: string[], opts: StartOptions): Promise<BgResult> {
        const { cwd, yieldMs, label, shell, stdin, cleanup } = opts;
        const proc = spawn(file, args, {
            shell,
            cwd,
            env:         buildChildEnv(),
            stdio:       ['pipe', 'pipe', 'pipe'],
            detached:    process.platform !== 'win32',
            windowsHide: true,
        });

        if (stdin !== undefined && proc.stdin) {
            proc.stdin.on('error', () => { /* ignore EPIPE */ });
            proc.stdin.end(stdin, 'utf8');
        }

        const id = crypto.randomBytes(4).toString('hex');
        const session: ProcSession = {
            id, proc, label,
            stdout: createStreamBuffer(),
            stderr: createStreamBuffer(),
            exited: false, exitCode: null, exitSignal: null,
            lastUsed: Date.now(), read: false,
            waiters: [],
            cleanup,
            cleaned: false,
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

        const collected = await this.collectOutput(session, clampYield(yieldMs), false);

        if (spawnError) {
            this.sessions.delete(id);
            this.cleanup(session);
            return { running: false, exitCode: -1, stdout: '', stderr: '', note: `Error: ${spawnError}` };
        }

        if (session.exited) {
            session.read = true;
            return {
                running: false,
                exitCode: session.exitCode,
                signal: session.exitSignal,
                ...collected,
                note: exitNote(session),
            };
        }
        return {
            taskId: id,
            running: true,
            ...collected,
            note: `[background] taskid=${id} still running — use read_task to read more output`,
        };
    }

    private wake(session: ProcSession): void {
        const waiters = session.waiters;
        session.waiters = [];
        for (const w of waiters) w();
    }

    private cleanup(session: ProcSession): void {
        if (!session.cleanup || session.cleaned) return;
        session.cleaned = true;
        Promise.resolve()
            .then(() => session.cleanup?.())
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
                void killTree(victim.proc, () => victim.exited).finally(() => this.cleanup(victim));
                logger?.info(`pruned background session ${victim.id} (${victim.label}) to stay under ${MAX_SESSIONS}`);
            }
        }
        this.sessions.set(session.id, session);
        this.ensureReaper();
    }

    private async collectOutput(session: ProcSession, yieldMs: number, returnOnData: boolean): Promise<{ stdout: string; stderr: string; truncated?: boolean }> {
        const deadline = Date.now() + yieldMs;

        for (;;) {
            if (returnOnData && (session.stdout.unread > 0 || session.stdout.overflow ||
                session.stderr.unread > 0 || session.stderr.overflow)) {
                return drainBoth(session);
            }
            if (session.exited) {
                await delay(GRACE_DRAIN_MS);
                return drainBoth(session);
            }
            const remaining = deadline - Date.now();
            if (remaining <= 0) return drainBoth(session);

            await new Promise<void>((resolve) => {
                let done = false;
                const finish = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
                const timer = setTimeout(finish, remaining);
                session.waiters.push(finish);
            });
        }
    }

    private ensureReaper(): void {
        if (this.reaper) return;
        this.reaper = setInterval(() => {
            const now = Date.now();
            for (const [id, s] of this.sessions) {
                const idle = now - s.lastUsed > IDLE_TIMEOUT_MS;
                if ((s.exited && s.read) || idle) {
                    this.sessions.delete(id);
                    if (!s.exited) void killTree(s.proc, () => s.exited).finally(() => this.cleanup(s));
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

function drainBoth(session: ProcSession): { stdout: string; stderr: string; truncated?: boolean } {
    const out = drainStream(session.stdout);
    const err = drainStream(session.stderr);
    const truncated = out.overflowed || err.overflowed;
    return { stdout: out.text, stderr: err.text, truncated: truncated || undefined };
}

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
    GIT_TERMINAL_PROMPT:  '0',
    GIT_ASKPASS:          'echo',
    SSH_ASKPASS:          'echo',
    GCM_INTERACTIVE:      'Never',
    DEBIAN_FRONTEND:      'noninteractive',
};

const SECRET_ENV_RE = /KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|AUTH|SESSION/i;

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

function createStreamBuffer(): StreamBuffer {
    return { chunks: [], unread: 0, overflow: false, decoder: new StringDecoder('utf8') };
}

function appendStream(sb: StreamBuffer, chunk: Buffer): void {
    if (sb.overflow) return;
    const remain = MAX_OUTPUT_BYTES - sb.unread;
    if (chunk.length >= remain) {
        if (remain > 0) { sb.chunks.push(chunk.subarray(0, remain)); sb.unread = MAX_OUTPUT_BYTES; }
        sb.overflow = true;
        return;
    }
    sb.chunks.push(chunk);
    sb.unread += chunk.length;
}

function drainStream(sb: StreamBuffer): { text: string; overflowed: boolean } {
    const overflowed = sb.overflow;
    if (sb.unread === 0) { sb.overflow = false; return { text: '', overflowed }; }
    const merged = Buffer.concat(sb.chunks, sb.unread);
    sb.chunks = [];
    sb.unread = 0;
    sb.overflow = false;
    return { text: sb.decoder.write(merged), overflowed };
}

function exitNote(session: ProcSession): string {
    if (session.exitSignal) return `Process terminated by signal ${session.exitSignal}`;
    return `Process exited with code ${session.exitCode ?? -1}`;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
}

export const ShellManager = new ShellManagerImpl();
