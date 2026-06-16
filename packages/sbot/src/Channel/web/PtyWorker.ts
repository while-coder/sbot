import type * as PtyTypes from '@lydell/node-pty';

interface OpenMessage {
    type: 'open';
    shell: string;
    args: string[];
    cwd: string;
    cols: number;
    rows: number;
    env: NodeJS.ProcessEnv;
}

interface InputMessage { type: 'input'; data: string; }
interface ResizeMessage { type: 'resize'; cols: number; rows: number; }
interface KillMessage { type: 'kill'; }
type ParentMessage = OpenMessage | InputMessage | ResizeMessage | KillMessage;

let ptyMod: typeof PtyTypes | null = null;
let term: PtyTypes.IPty | null = null;
let exited = false;

function send(obj: object): void {
    try { process.send?.(obj); } catch { /* parent is gone */ }
}

function loadPty(): typeof PtyTypes | null {
    if (ptyMod) return ptyMod;
    try {
        ptyMod = require('@lydell/node-pty') as typeof PtyTypes;
        return ptyMod;
    } catch (e: any) {
        send({ type: 'error', message: `@lydell/node-pty unavailable: ${e?.message ?? e}` });
        return null;
    }
}

function cleanup(): void {
    if (term && !exited) {
        try { term.kill(); } catch { /* already gone */ }
    }
    term = null;
}

process.on('message', (msg: ParentMessage) => {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'open') {
        if (term) return;
        const mod = loadPty();
        if (!mod) {
            process.exit(1);
            return;
        }
        try {
            term = mod.spawn(msg.shell, msg.args ?? [], {
                name: 'xterm-256color',
                cols: msg.cols,
                rows: msg.rows,
                cwd: msg.cwd,
                env: msg.env,
            });
        } catch (e: any) {
            send({ type: 'error', message: `Failed to spawn shell: ${e?.message ?? e}` });
            process.exit(1);
            return;
        }
        term.onData(data => send({ type: 'data', data }));
        term.onExit(({ exitCode, signal }) => {
            exited = true;
            send({ type: 'exit', code: exitCode, signal });
            process.exit(0);
        });
        send({ type: 'ready', shell: msg.shell, cwd: msg.cwd, pid: term.pid });
        return;
    }

    if (!term) return;

    if (msg.type === 'input') {
        try { term.write(msg.data); } catch (e: any) { send({ type: 'error', message: `pty.write: ${e?.message ?? e}` }); }
        return;
    }

    if (msg.type === 'resize') {
        try { term.resize(msg.cols, msg.rows); } catch (e: any) { send({ type: 'error', message: `pty.resize: ${e?.message ?? e}` }); }
        return;
    }

    if (msg.type === 'kill') {
        cleanup();
        process.exit(0);
    }
});

process.on('disconnect', () => {
    cleanup();
    process.exit(0);
});

process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
});

