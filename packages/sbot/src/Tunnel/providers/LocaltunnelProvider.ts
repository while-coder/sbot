import { TunnelProviderType } from "sbot.commons";
import type { TunnelProvider, TunnelStartResult } from "../TunnelProvider";

/**
 * localtunnel npm 包的最小类型描述。运行时由 require('localtunnel') 提供。
 */
interface LocaltunnelInstance {
    url: string;
    on(event: "close" | "error", listener: (...args: any[]) => void): void;
    close(): void;
}
type LocaltunnelFn = (opts: { port: number; subdomain?: string }) => Promise<LocaltunnelInstance>;

export class LocaltunnelProvider implements TunnelProvider {
    readonly type = TunnelProviderType.Localtunnel;

    private instance?: LocaltunnelInstance;
    private logSubs = new Set<(line: string) => void>();
    private exitSubs = new Set<(reason: string) => void>();
    private readonly subdomain?: string;
    private closed = false;

    constructor(subdomain?: string) {
        this.subdomain = subdomain;
    }

    async start(localPort: number): Promise<TunnelStartResult> {
        if (this.instance) await this.stop();
        this.closed = false;

        let lt: LocaltunnelFn;
        try {
            // 延迟 require，避免无配置时也加载
            lt = require("localtunnel") as LocaltunnelFn;
        } catch (e: any) {
            throw new Error(`Failed to load 'localtunnel' module: ${e?.message ?? e}. Run 'pnpm install' to ensure it is installed.`);
        }

        this.emitLog(`Connecting to localtunnel server (port=${localPort}${this.subdomain ? `, subdomain=${this.subdomain}` : ""})`);
        const tunnel = await lt({ port: localPort, subdomain: this.subdomain });
        this.instance = tunnel;
        this.emitLog(`Tunnel ready: ${tunnel.url}`);

        tunnel.on("close", () => {
            const reason = "localtunnel closed";
            this.emitLog(reason);
            if (!this.closed) this.emitExit(reason);
        });
        tunnel.on("error", (err: any) => {
            const msg = `localtunnel error: ${err?.message ?? err}`;
            this.emitLog(msg);
            if (!this.closed) this.emitExit(msg);
        });

        return { publicUrl: tunnel.url };
    }

    async stop(): Promise<void> {
        const inst = this.instance;
        if (!inst) return;
        this.instance = undefined;
        this.closed = true;
        try { inst.close(); } catch { }
    }

    isHealthy(): boolean {
        return !!this.instance && !this.closed;
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
