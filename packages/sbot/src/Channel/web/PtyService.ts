import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { WebSocketServer, WebSocket } from 'ws';
import * as pty from 'node-pty';
import { LoggerService } from '../../Core/LoggerService';

const logger = LoggerService.getLogger('PtyService.ts');

export interface ShellOption {
    /** Stable id, used by client when requesting `open`. */
    id: string;
    /** Display label, e.g. "PowerShell" / "/bin/bash". */
    label: string;
    /** Absolute executable path. */
    path: string;
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

    const candidates: Array<[string, string]> = [
        [path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), 'PowerShell'],
        [path.join(sysRoot, 'System32', 'cmd.exe'), 'Command Prompt'],
        [path.join(programFiles, 'PowerShell', '7', 'pwsh.exe'), 'PowerShell 7'],
        [path.join(programFilesX86, 'PowerShell', '7', 'pwsh.exe'), 'PowerShell 7 (x86)'],
        [path.join(programFiles, 'Git', 'bin', 'bash.exe'), 'Git Bash'],
        [path.join(programFilesX86, 'Git', 'bin', 'bash.exe'), 'Git Bash (x86)'],
        [path.join(localAppData, 'Microsoft', 'WindowsApps', 'wsl.exe'), 'WSL'],
    ];
    const seen = new Set<string>();
    for (const [p, label] of candidates) {
        if (!p || seen.has(p.toLowerCase()) || !fileExists(p)) continue;
        seen.add(p.toLowerCase());
        out.push({ id: p, label, path: p });
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

function sanitizeCwd(cwd?: string): string | undefined {
    if (!cwd) return undefined;
    try {
        const stat = fs.statSync(cwd);
        if (stat.isDirectory()) return cwd;
    } catch { /* fall through */ }
    return undefined;
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
        wss.on('connection', (ws) => this.handleConnection(ws));
        server.on('upgrade', (req, socket, head) => {
            const url = req.url ?? '';
            const pathname = url.split('?')[0];
            if (pathname !== '/ws/pty') return;
            wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
        });
        logger.info('PtyService attached to /ws/pty');
    }

    private handleConnection(ws: WebSocket): void {
        let term: pty.IPty | null = null;
        let opened = false;
        let exited = false;

        const sendControl = (obj: object) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
        };

        const cleanup = () => {
            if (term && !exited) {
                try { term.kill(); } catch { /* pty already dead */ }
            }
            term = null;
        };

        ws.on('message', (raw, isBinary) => {
            // Bytes only make sense once the pty is open, and they are user input.
            if (isBinary) {
                if (!term) return;
                try { term.write(raw.toString('utf8')); } catch (e: any) { logger.warn(`pty.write: ${e?.message ?? e}`); }
                return;
            }
            let msg: ClientMessage;
            try { msg = JSON.parse(raw.toString('utf8')); } catch { return; }

            if (msg.type === 'open') {
                if (opened) return;
                opened = true;
                const shells = listShells();
                const requested = msg.shell?.trim();
                const shellPath = requested && fileExists(requested) ? requested : defaultShell(shells);
                const cwd = sanitizeCwd(msg.cwd) ?? os.homedir();
                const cols = Math.max(2, Math.min(500, msg.cols ?? 80));
                const rows = Math.max(2, Math.min(200, msg.rows ?? 24));
                const env: NodeJS.ProcessEnv = { ...process.env, ...msg.env, TERM: 'xterm-256color' };
                try {
                    // useConpty: false on Windows — ConPTY requires the parent to have
                    // a real console window. When sbot runs under VS Code's Launch
                    // configuration (or any debugger / service host without a console),
                    // ConPTY initialization deadlocks and pty.spawn never returns.
                    // Falling back to winpty (bundled with node-pty) works in those
                    // contexts at the cost of some ANSI fidelity. Set SBOT_PTY_CONPTY=1
                    // to force ConPTY when running in a real terminal.
                    const useConpty = process.platform === 'win32'
                        ? process.env.SBOT_PTY_CONPTY === '1'
                        : undefined;
                    term = pty.spawn(shellPath, [], {
                        name: 'xterm-256color',
                        cols, rows, cwd, env,
                        ...(useConpty !== undefined ? { useConpty } : {}),
                    } as any);
                } catch (e: any) {
                    logger.error(`pty.spawn failed (shell=${shellPath}): ${e?.message ?? e}`);
                    sendControl({ type: 'error', message: `Failed to spawn shell: ${e?.message ?? e}` });
                    ws.close();
                    return;
                }
                term.onData(data => {
                    if (ws.readyState === WebSocket.OPEN) ws.send(data);
                });
                term.onExit(({ exitCode, signal }) => {
                    exited = true;
                    sendControl({ type: 'exit', code: exitCode, signal });
                    try { ws.close(); } catch { /* ignore */ }
                });
                sendControl({ type: 'ready', shell: shellPath, cwd, pid: term.pid });
                return;
            }

            if (!term) return;

            if (msg.type === 'input') {
                try { term.write(msg.data); } catch (e: any) { logger.warn(`pty.write: ${e?.message ?? e}`); }
                return;
            }

            if (msg.type === 'resize') {
                const cols = Math.max(2, Math.min(500, msg.cols));
                const rows = Math.max(2, Math.min(200, msg.rows));
                try { term.resize(cols, rows); } catch (e: any) { logger.warn(`pty.resize: ${e?.message ?? e}`); }
            }
        });

        ws.on('close', cleanup);
        ws.on('error', () => cleanup());
    }

    dispose(): void {
        try { this.wss?.close(); } catch { /* ignore */ }
        this.wss = undefined;
    }
}

export const ptyService = new PtyService();
