import { spawn, type ChildProcess } from "child_process";
import { TunnelProviderType } from "sbot.commons";
import type { TunnelProvider, TunnelStartResult } from "../TunnelProvider";
import { BinaryManager } from "../BinaryManager";

const TRYCLOUDFLARE_RE = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;
const URL_WAIT_TIMEOUT_MS = 30_000;

export class CloudflareQuickProvider implements TunnelProvider {
    readonly type = TunnelProviderType.CloudflareQuick;

    private proc?: ChildProcess;
    private logSubs = new Set<(line: string) => void>();
    private exitSubs = new Set<(reason: string) => void>();
    private binaryManager: BinaryManager;

    constructor(binaryManager?: BinaryManager) {
        this.binaryManager = binaryManager ?? new BinaryManager();
    }

    async start(localPort: number): Promise<TunnelStartResult> {
        if (this.proc && this.proc.exitCode === null) {
            await this.stop();
        }

        const bin = await this.binaryManager.ensure((msg) => this.emitLog(`[bin] ${msg}`));
        this.emitLog(`Starting cloudflared --url http://localhost:${localPort}`);

        const proc = spawn(bin, ["tunnel", "--url", `http://localhost:${localPort}`, "--no-autoupdate"], {
            stdio: ["ignore", "pipe", "pipe"],
        });
        this.proc = proc;

        const lineHandler = (chunk: Buffer | string) => {
            const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
            for (const line of text.split(/\r?\n/)) {
                if (line.trim()) this.emitLog(line.trim());
            }
        };
        proc.stdout?.on("data", lineHandler);
        proc.stderr?.on("data", lineHandler);

        proc.once("exit", (code, signal) => {
            const reason = `cloudflared exited (code=${code} signal=${signal})`;
            this.emitLog(reason);
            // start() resolve 之后才算"意外退出"；start 期间的退出由下面的 race 处理
            if ((this as any)._urlResolved) {
                this.emitExit(reason);
            }
        });

        const url = await new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => {
                cleanup();
                reject(new Error(`cloudflared did not produce a public URL within ${URL_WAIT_TIMEOUT_MS / 1000}s`));
            }, URL_WAIT_TIMEOUT_MS);

            const onLog = (line: string) => {
                const m = line.match(TRYCLOUDFLARE_RE);
                if (m) {
                    cleanup();
                    resolve(m[0]);
                }
            };
            const onExit = (code: number | null) => {
                cleanup();
                reject(new Error(`cloudflared exited prematurely (code=${code})`));
            };
            const cleanup = () => {
                clearTimeout(timer);
                this.logSubs.delete(onLog);
                proc.off("exit", onExit);
            };

            this.logSubs.add(onLog);
            proc.on("exit", onExit);
        });

        (this as any)._urlResolved = true;
        return { publicUrl: url };
    }

    async stop(): Promise<void> {
        const proc = this.proc;
        if (!proc) return;
        this.proc = undefined;
        if (proc.exitCode !== null) return;

        proc.kill("SIGTERM");
        await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
                try { proc.kill("SIGKILL"); } catch { }
                resolve();
            }, 5000);
            proc.once("exit", () => {
                clearTimeout(timer);
                resolve();
            });
        });
    }

    isHealthy(): boolean {
        return !!this.proc && this.proc.exitCode === null;
    }

    onLog(cb: (line: string) => void): () => void {
        this.logSubs.add(cb);
        return () => this.logSubs.delete(cb);
    }

    onExit(cb: (reason: string) => void): () => void {
        this.exitSubs.add(cb);
        return () => this.exitSubs.delete(cb);
    }

    private emitLog(line: string): void {
        for (const cb of this.logSubs) {
            try { cb(line); } catch { }
        }
    }

    private emitExit(reason: string): void {
        for (const cb of this.exitSubs) {
            try { cb(reason); } catch { }
        }
    }
}
