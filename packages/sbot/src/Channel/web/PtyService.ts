import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fork, type ChildProcess } from 'child_process';
import { WebSocketServer, WebSocket } from 'ws';
import { LoggerService } from '../../Core/LoggerService';

const logger = LoggerService.getLogger('PtyService.ts');
const OPEN_TIMEOUT_MS = 10_000;
const WORKER_READY_TIMEOUT_MS = 10_000;
const OUTPUT_BACKPRESSURE_LIMIT = 2 * 1024 * 1024;

export interface ShellOption {
    /** Stable id, used by client when requesting `open`. */
    id: string;
    /** Display label, e.g. "PowerShell" / "/bin/bash". */
    label: string;
    /** Absolute executable path. */
    path: string;
    /** Server-side default arguments for safer interactive startup. */
    args?: string[];
}

interface OpenMessage {
    type: 'open';
    shell?: string;
    cwd?: string;
    cols?: number;
    rows?: number;
    env?: Record<string, string>;
}

interface InputMessage { type: 'input'; data: string; }
interface ResizeMessage { type: 'resize'; cols: number; rows: number; }
type ClientMessage = OpenMessage | InputMessage | ResizeMessage;

type WorkerMessage =
    | { type: 'ready'; shell: string; cwd: string; pid: number }
    | { type: 'data'; data: string }
    | { type: 'exit'; code?: number; signal?: number }
    | { type: 'error'; message: string };

let cachedShells: ShellOption[] | null = null;

function fileExists(p: string): boolean {
    try { fs.accessSync(p, fs.constants.X_OK); return true; }
    catch { return false; }
}

function detectWindowsShells(): ShellOption[] {
    const out: ShellOption[] = [];
    const sysRoot = process.env.SystemRoot ?? 'C:\\Windows';
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    const localAppData = process.env.LOCALAPPDATA ?? '';

    const candidates: Array<[string, string, string[]?]> = [
        [path.join(sysRoot, 'System32', 'cmd.exe'), 'Command Prompt'],
        [path.join(programFiles, 'PowerShell', '7', 'pwsh.exe'), 'PowerShell 7', ['-NoLogo', '-NoProfile']],
        [path.join(programFilesX86, 'PowerShell', '7', 'pwsh.exe'), 'PowerShell 7 (x86)', ['-NoLogo', '-NoProfile']],
        [path.join(programFiles, 'Git', 'bin', 'bash.exe'), 'Git Bash'],
        [path.join(programFilesX86, 'Git', 'bin', 'bash.exe'), 'Git Bash (x86)'],
        [path.join(localAppData, 'Microsoft', 'WindowsApps', 'wsl.exe'), 'WSL'],
    ];
    const seen = new Set<string>();
    for (const [p, label, args] of candidates) {
        if (!p || seen.has(p.toLowerCase()) || !fileExists(p)) continue;
        seen.add(p.toLowerCase());
        out.push({ id: p, label, path: p, args });
    }
    return out;
}

function detectUnixShells(): ShellOption[] {
    const out: ShellOption[] = [];
    const seen = new Set<string>();
    const fromUserShell = process.env.SHELL;
    const tryAdd = (p: string, label?: string) => {
        if (!p || seen.has(p) || !fileExists(p)) return;
        seen.add(p);
        out.push({ id: p, label: label ?? p, path: p });
    };

    // /etc/shells is the canonical list of valid login shells.
    try {
        const text = fs.readFileSync('/etc/shells', 'utf8');
        for (const raw of text.split(/\r?\n/)) {
            const line = raw.trim();
            if (!line || line.startsWith('#')) continue;
            if (/\/(nologin|false)$/.test(line)) continue;
            tryAdd(line);
        }
    } catch { /* ignore — file may not exist on minimal containers */ }

    if (fromUserShell) tryAdd(fromUserShell);
    for (const fallback of ['/bin/bash', '/bin/zsh', '/bin/sh']) tryAdd(fallback);

    return out;
}

export function listShells(force = false): ShellOption[] {
    if (!force && cachedShells) return cachedShells;
    cachedShells = process.platform === 'win32' ? detectWindowsShells() : detectUnixShells();
    return cachedShells;
}

function defaultShell(shells: ShellOption[]): string {
    if (process.platform === 'win32') {
        return process.env.ComSpec ?? shells[0]?.path ?? 'cmd.exe';
    }
    return process.env.SHELL ?? shells[0]?.path ?? '/bin/sh';
}

function resolveShell(requested: string | undefined, shells: ShellOption[]): { path: string; args: string[] } {
    if (requested) {
        const known = shells.find(s => s.path.toLowerCase() === requested.toLowerCase());
        if (known) return { path: known.path, args: known.args ?? [] };
        if (fileExists(requested)) return { path: requested, args: [] };
    }
    const fallbackPath = defaultShell(shells);
    const fallback = shells.find(s => s.path.toLowerCase() === fallbackPath.toLowerCase());
    return { path: fallbackPath, args: fallback?.args ?? [] };
}

function isBlockedShell(shellPath: string): boolean {
    if (process.platform !== 'win32') return false;
    const normalized = shellPath.toLowerCase();
    return normalized.endsWith('\\windowspowershell\\v1.0\\powershell.exe');
}

function sanitizeCwd(cwd?: string): string | undefined {
    if (!cwd) return undefined;
    try {
        const stat = fs.statSync(cwd);
        if (stat.isDirectory()) return cwd;
    } catch { /* fall through */ }
    return undefined;
}

function workerScriptPath(): string {
    return path.join(__dirname, 'PtyWorker.js');
}

/**
 * Per-connection: one WebSocket drives one pty. Closing either side tears down the other.
 *
 * Wire format:
 *   client → server: text JSON for control (`open` / `resize`) and `input`.
 *   server → client: binary frames for stdout/stderr; text JSON for control (`exit`, `error`).
 */
export class PtyService {
    private wss?: WebSocketServer;

    attach(server: http.Server): void {
        // noServer + manual upgrade routing: a second WSS with `{ server, path }` would
        // also subscribe to the http upgrade event and send 400 for paths it doesn't
        // own — corrupting the already-101'd response of whichever WSS handled the
        // request. Routing here keeps each WSS to its own path.
        const wss = this.wss = new WebSocketServer({ noServer: true });
        wss.on('connection', (ws, req) => this.handleConnection(ws, req));
        wss.on('error', e => logger.warn(`pty websocket server error: ${e?.message ?? e}`));
        server.on('upgrade', (req, socket, head) => {
            const url = req.url ?? '';
            const pathname = url.split('?')[0];
            if (pathname !== '/ws/pty') return;
            try {
                wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
            } catch (e: any) {
                logger.error(`pty upgrade failed: ${e?.message ?? e}`);
                try { socket.destroy(); } catch { /* ignore */ }
            }
        });
        logger.info('PtyService attached to /ws/pty');
    }

    private handleConnection(ws: WebSocket, req: http.IncomingMessage): void {
        let worker: ChildProcess | null = null;
        let opened = false;
        let ready = false;
        let exited = false;
        let readyTimer: ReturnType<typeof setTimeout> | null = null;
        const peer = `${req.socket.remoteAddress}:${req.socket.remotePort}`;

        const sendControl = (obj: object) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            try {
                ws.send(JSON.stringify(obj), err => {
                    if (err) logger.warn(`pty control send failed: peer=${peer} err=${err.message}`);
                });
            } catch (e: any) {
                logger.warn(`pty control send failed: peer=${peer} err=${e?.message ?? e}`);
            }
        };

        const clearReadyTimer = () => {
            if (readyTimer) {
                clearTimeout(readyTimer);
                readyTimer = null;
            }
        };

        const sendWorker = (obj: object) => {
            if (!worker?.connected) return;
            try {
                worker.send(obj, err => {
                    if (err) logger.warn(`pty worker send failed: peer=${peer} err=${err.message}`);
                });
            } catch (e: any) {
                logger.warn(`pty worker send failed: peer=${peer} err=${e?.message ?? e}`);
            }
        };

        const cleanup = () => {
            clearTimeout(openTimer);
            clearReadyTimer();
            if (worker && !exited) {
                try {
                    if (worker.connected) worker.send({ type: 'kill' });
                } catch { /* worker may already be wedged */ }
                try { worker.kill(); } catch { /* already gone */ }
            }
            worker = null;
        };

        const openTimer = setTimeout(() => {
            if (opened || ws.readyState !== WebSocket.OPEN) return;
            logger.warn(`pty open timeout: peer=${peer}`);
            sendControl({ type: 'error', message: 'Terminal open timeout' });
            try { ws.close(1008, 'open timeout'); } catch { /* ignore */ }
        }, OPEN_TIMEOUT_MS);

        logger.info(`pty connected: peer=${peer}`);

        ws.on('message', (raw, isBinary) => {
            // Bytes only make sense once the pty is open, and they are user input.
            if (isBinary) {
                if (!ready) return;
                sendWorker({ type: 'input', data: raw.toString('utf8') });
                return;
            }
            let msg: ClientMessage;
            try { msg = JSON.parse(raw.toString('utf8')); } catch { return; }

            if (msg.type === 'open') {
                if (opened) return;
                opened = true;
                clearTimeout(openTimer);
                const shells = listShells();
                const requested = msg.shell?.trim();
                const shell = resolveShell(requested, shells);
                if (isBlockedShell(shell.path)) {
                    logger.warn(`pty blocked shell: peer=${peer} shell=${shell.path}`);
                    sendControl({ type: 'error', message: 'Windows PowerShell 5.1 is disabled for the built-in terminal because it can block node-pty startup on this server. Use Command Prompt, PowerShell 7, Git Bash, or WSL instead.' });
                    ws.close();
                    return;
                }
                const cwd = sanitizeCwd(msg.cwd) ?? os.homedir();
                const cols = Math.max(2, Math.min(500, msg.cols ?? 80));
                const rows = Math.max(2, Math.min(200, msg.rows ?? 24));
                const env: NodeJS.ProcessEnv = { ...process.env, ...msg.env, TERM: 'xterm-256color' };
                logger.info(`pty opening: peer=${peer} shell=${shell.path} cwd=${cwd} size=${cols}x${rows}`);

                const workerPath = workerScriptPath();
                if (!fs.existsSync(workerPath)) {
                    logger.error(`pty worker script missing: ${workerPath}`);
                    sendControl({ type: 'error', message: 'Terminal worker script is missing. Please rebuild sbot.' });
                    ws.close();
                    return;
                }
                try {
                    worker = fork(workerPath, [], {
                        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
                        execArgv: [],
                        env: { ...process.env, NODE_OPTIONS: '' },
                    });
                } catch (e: any) {
                    logger.error(`pty worker fork failed: ${e?.message ?? e}`);
                    sendControl({ type: 'error', message: `Failed to start terminal worker: ${e?.message ?? e}` });
                    ws.close();
                    return;
                }

                readyTimer = setTimeout(() => {
                    if (ready || exited) return;
                    logger.error(`pty worker ready timeout: peer=${peer} shell=${shell.path}`);
                    sendControl({ type: 'error', message: 'Terminal startup timed out; the pty worker was stopped.' });
                    try { ws.close(1011, 'pty startup timeout'); } catch { /* ignore */ }
                    cleanup();
                }, WORKER_READY_TIMEOUT_MS);

                worker.on('message', (raw: WorkerMessage) => {
                    if (!raw || typeof raw !== 'object') return;

                    if (raw.type === 'ready') {
                        ready = true;
                        clearReadyTimer();
                        logger.info(`pty ready: peer=${peer} pid=${raw.pid}`);
                        sendControl({ type: 'ready', shell: raw.shell, cwd: raw.cwd, pid: raw.pid });
                        return;
                    }

                    if (raw.type === 'data') {
                        if (ws.readyState !== WebSocket.OPEN) return;
                        if (ws.bufferedAmount > OUTPUT_BACKPRESSURE_LIMIT) {
                            logger.warn(`pty output backpressure, closing: peer=${peer} buffered=${ws.bufferedAmount}`);
                            sendControl({ type: 'error', message: 'Terminal output is too large or the client is too slow; closing terminal.' });
                            try { ws.close(1011, 'pty output backpressure'); } catch { /* ignore */ }
                            cleanup();
                            return;
                        }
                        try {
                            ws.send(raw.data, err => {
                                if (err) logger.warn(`pty output send failed: peer=${peer} err=${err.message}`);
                            });
                        } catch (e: any) {
                            logger.warn(`pty output send failed: peer=${peer} err=${e?.message ?? e}`);
                        }
                        return;
                    }

                    if (raw.type === 'error') {
                        logger.error(`pty worker error: peer=${peer} message=${raw.message}`);
                        sendControl({ type: 'error', message: raw.message });
                        try { ws.close(); } catch { /* ignore */ }
                        cleanup();
                        return;
                    }

                    if (raw.type === 'exit') {
                        exited = true;
                        clearReadyTimer();
                        logger.info(`pty exited: peer=${peer} code=${raw.code} signal=${raw.signal ?? ''}`);
                        sendControl({ type: 'exit', code: raw.code, signal: raw.signal });
                        try { ws.close(); } catch { /* ignore */ }
                    }
                });
                worker.on('exit', (code, signal) => {
                    clearReadyTimer();
                    if (exited) return;
                    exited = true;
                    logger.info(`pty worker exited: peer=${peer} code=${code} signal=${signal ?? ''}`);
                    if (ws.readyState === WebSocket.OPEN) {
                        sendControl({ type: 'exit', code, signal });
                    }
                    try { ws.close(); } catch { /* ignore */ }
                });
                worker.on('error', e => {
                    clearReadyTimer();
                    logger.error(`pty worker process error: peer=${peer} err=${e?.message ?? e}`);
                    sendControl({ type: 'error', message: `Terminal worker error: ${e?.message ?? e}` });
                    try { ws.close(); } catch { /* ignore */ }
                    cleanup();
                });
                sendWorker({ type: 'open', shell: shell.path, args: shell.args, cwd, cols, rows, env });
                return;
            }

            if (!ready) return;

            if (msg.type === 'input') {
                sendWorker({ type: 'input', data: msg.data });
                return;
            }

            if (msg.type === 'resize') {
                const cols = Math.max(2, Math.min(500, msg.cols));
                const rows = Math.max(2, Math.min(200, msg.rows));
                sendWorker({ type: 'resize', cols, rows });
            }
        });

        ws.on('close', (code, reason) => {
            logger.info(`pty closed: peer=${peer} code=${code} reason=${reason?.toString() || ''}`);
            cleanup();
        });
        ws.on('error', e => {
            logger.warn(`pty websocket error: peer=${peer} err=${e?.message ?? e}`);
            cleanup();
        });
    }

    dispose(): void {
        try { this.wss?.close(); } catch { /* ignore */ }
        this.wss = undefined;
    }
}

export const ptyService = new PtyService();
