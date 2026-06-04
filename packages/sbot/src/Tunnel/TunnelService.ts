import type { TunnelStatus, TunnelConfig } from "sbot.commons";
import { LoggerService } from "../Core/LoggerService";
import { config } from "../Core/Config";
import type { TunnelProvider } from "./TunnelProvider";
import { CloudflareQuickProvider } from "./providers/CloudflareQuickProvider";
import { CloudflareTokenProvider } from "./providers/CloudflareTokenProvider";
import { LocaltunnelProvider } from "./providers/LocaltunnelProvider";

const logger = LoggerService.getLogger("TunnelService.ts");
const LOG_BUFFER_SIZE = 200;

/** 单个 tunnel 的运行实例 */
interface ProviderInstance {
    provider: TunnelProvider;
    publicUrl?: string;
    startedAt?: number;
    lastError?: string;
    logs: string[];
    detachLog: () => void;
    detachExit: () => void;
}

class TunnelService {
    /** id -> 运行实例。只包含已启动（含启动失败留尾巴的）的 tunnel */
    private instances = new Map<string, ProviderInstance>();
    /** 单个 id 的启动 / 停止 互斥 */
    private locks = new Map<string, Promise<void>>();

    private buildProvider(cfg: TunnelConfig): TunnelProvider {
        switch (cfg.type) {
            case "cloudflare-quick":
                return new CloudflareQuickProvider();
            case "cloudflare-token": {
                const token = (cfg.cloudflareToken ?? "").trim();
                if (!token) throw new Error(`tunnel "${cfg.id}": cloudflareToken 未配置`);
                const display = (cfg.cloudflareTokenPublicUrl ?? "").trim();
                return new CloudflareTokenProvider(token, display);
            }
            case "localtunnel":
                return new LocaltunnelProvider(cfg.localtunnelSubdomain?.trim() || undefined);
            default:
                throw new Error(`未知的 tunnel provider: ${(cfg as any).type}`);
        }
    }

    private withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
        const prev = this.locks.get(id) ?? Promise.resolve();
        const next = prev.then(fn).finally(() => {
            if (this.locks.get(id) === next) this.locks.delete(id);
        });
        this.locks.set(id, next as Promise<any>);
        return next;
    }

    private appendLog(inst: ProviderInstance, line: string): void {
        const stamped = `[${new Date().toISOString()}] ${line}`;
        inst.logs.push(stamped);
        if (inst.logs.length > LOG_BUFFER_SIZE) {
            inst.logs.splice(0, inst.logs.length - LOG_BUFFER_SIZE);
        }
    }

    private getConfig(id: string): TunnelConfig | undefined {
        return config.settings.tunnel?.find(c => c.id === id);
    }

    /** 启动单个 tunnel */
    async startEntry(id: string, localPort: number): Promise<void> {
        return this.withLock(id, async () => {
            const cfg = this.getConfig(id);
            if (!cfg) throw new Error(`tunnel not found: ${id}`);

            await this.stopEntryInternal(id);

            let provider: TunnelProvider;
            try {
                provider = this.buildProvider(cfg);
            } catch (e: any) {
                // 启动失败也保留一个壳，让 status 能展示错误
                const inst: ProviderInstance = {
                    provider: null as any,
                    lastError: e?.message ?? String(e),
                    logs: [`[${new Date().toISOString()}] ERROR: ${e?.message ?? e}`],
                    detachLog: () => { },
                    detachExit: () => { },
                };
                this.instances.set(id, inst);
                throw e;
            }

            const inst: ProviderInstance = {
                provider,
                logs: [],
                detachLog: () => { },
                detachExit: () => { },
            };
            inst.detachLog = provider.onLog((line) => this.appendLog(inst, line));
            inst.detachExit = provider.onExit((reason) => {
                inst.lastError = reason;
                inst.publicUrl = undefined;
                inst.startedAt = undefined;
            });

            this.instances.set(id, inst);
            this.appendLog(inst, `Starting "${cfg.name ?? cfg.id}" (provider=${cfg.type}, port=${localPort})`);

            try {
                const { publicUrl } = await provider.start(localPort);
                inst.publicUrl = publicUrl || undefined;
                inst.startedAt = Date.now();
                this.appendLog(inst, `Tunnel ready: ${publicUrl || "(no URL — see provider notes)"}`);
            } catch (e: any) {
                inst.lastError = e?.message ?? String(e);
                this.appendLog(inst, `ERROR: ${inst.lastError}`);
                try { await provider.stop(); } catch { }
                throw e;
            }
        });
    }

    /** 停止单个 tunnel（外部 API）*/
    async stopEntry(id: string): Promise<void> {
        return this.withLock(id, () => this.stopEntryInternal(id));
    }

    /** 内部停止逻辑（不抢锁；调用方负责锁） */
    private async stopEntryInternal(id: string): Promise<void> {
        const inst = this.instances.get(id);
        if (!inst) return;

        const cfg = this.getConfig(id);
        const label = cfg?.name ?? id;

        try { inst.detachLog(); } catch { }
        try { inst.detachExit(); } catch { }

        if (inst.provider) {
            this.appendLog(inst, `Stopping "${label}"`);
            try { await inst.provider.stop(); } catch (e: any) {
                logger.warn(`tunnel "${id}" stop error: ${e?.message ?? e}`);
            }
        }

        // 保留 inst 在 map 里以便 status 显示最后日志和错误，
        // 但状态变成 not running（provider 已 stop）。
        inst.publicUrl = undefined;
        inst.startedAt = undefined;
    }

    /** 启动所有 enabled 的 tunnel，互不阻塞；任一失败不影响其他 */
    async startAll(localPort: number): Promise<void> {
        const list = (config.settings.tunnel ?? []).filter(c => c.id && c.enabled !== false);
        if (list.length === 0) return;

        const results = await Promise.allSettled(
            list.map(c => this.startEntry(c.id, localPort))
        );
        let succeeded = 0;
        for (let i = 0; i < results.length; i++) {
            const r = results[i];
            if (r.status === "rejected") {
                logger.warn(`tunnel "${list[i].id}" start failed: ${r.reason?.message ?? r.reason}`);
            } else {
                succeeded++;
            }
        }
        logger.info(`Tunnel started ${succeeded}/${list.length}`);
    }

    /** 停所有 */
    async stopAll(): Promise<void> {
        const ids = [...this.instances.keys()];
        await Promise.allSettled(ids.map(id => this.stopEntry(id)));
    }

    getStatus(): TunnelStatus[] {
        const list = config.settings.tunnel ?? [];
        return list.map(cfg => {
            const inst = this.instances.get(cfg.id);
            return {
                id: cfg.id,
                name: cfg.name,
                type: cfg.type,
                enabled: cfg.enabled !== false,
                running: !!inst?.provider && inst.provider.isHealthy(),
                publicUrl: inst?.publicUrl,
                startedAt: inst?.startedAt,
                error: inst?.lastError,
                recentLogs: inst ? [...inst.logs] : [],
            };
        });
    }
}

export const tunnelService = new TunnelService();
