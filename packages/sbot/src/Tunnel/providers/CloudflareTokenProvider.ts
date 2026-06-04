import { spawn, type ChildProcess } from "child_process";
import { TunnelProviderType } from "sbot.commons";
import type { TunnelProvider, TunnelStartResult } from "../TunnelProvider";
import { BinaryManager } from "../BinaryManager";

/**
 * Cloudflare Named/Token Tunnel：cloudflared tunnel run --token <jwt>
 *
 * 与 Quick Tunnel 不同，token 模式下 cloudflared 不会在日志里输出公网 URL —— URL
 * 由用户在 Cloudflare 后台 Public Hostname 配置后，存到 settings.tunnel.cloudflareTokenPublicUrl
 * 由 admin UI 直接展示。这里 start() 返回的 publicUrl 由 service 层填入配置值。
 */
export class CloudflareTokenProvider implements TunnelProvider {
    readonly type = TunnelProviderType.CloudflareToken;

    private proc?: ChildProcess;
    private logSubs = new Set<(line: string) => void>();
    private exitSubs = new Set<(reason: string) => void>();
    private binaryManager: BinaryManager;
    private readonly token: string;
    private readonly displayUrl: string;

    constructor(token: string, displayUrl: string, binaryManager?: BinaryManager) {
        if (!token) throw new Error("cloudflareToken is required for cloudflare-token provider");
        this.token = token;
        this.displayUrl = displayUrl;
        this.binaryManager = binaryManager ?? new BinaryManager();
    }

    async start(_localPort: number): Promise<TunnelStartResult> {
        if (this.proc && this.proc.exitCode === null) {
            await this.stop();
        }

        const bin = await this.binaryManager.ensure((msg) => this.emitLog(`[bin] ${msg}`));
        this.emitLog(`Starting cloudflared tunnel run (token mode)`);

        const proc = spawn(bin, ["tunnel", "run", "--token", this.token, "--no-autoupdate"], {
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

        const startedAt = Date.now();

        const ready = new Promise<void>((resolve, reject) => {
            const onExit = (code: number | null) => {
                cleanup();
                reject(new Error(`cloudflared exited prematurely (code=${code})`));
            };
            const onLog = (line: string) => {
                // cloudflared 启动时打印 "Registered tunnel connection" 表示连接已建立
                if (/Registered tunnel connection|Connection .* registered/i.test(line)) {
                    cleanup();
                    resolve();
                }
            };
            const timer = setTimeout(() => {
                cleanup();
                resolve(); // 30 秒还没看到注册成功的日志，也认为已经在运行（cloudflared 自己会重试）
            }, 30_000);
            const cleanup = () => {
                clearTimeout(timer);
                this.logSubs.delete(onLog);
                proc.off("exit", onExit);
            };
            this.logSubs.add(onLog);
            proc.on("exit", onExit);
        });

        proc.once("exit", (code, signal) => {
            const reason = `cloudflared exited (code=${code} signal=${signal})`;
            this.emitLog(reason);
            // 启动后退出才算意外退出
            if (Date.now() - startedAt > 1_000) {
                this.emitExit(reason);
            }
        });

        await ready;
        return { publicUrl: this.displayUrl };
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
