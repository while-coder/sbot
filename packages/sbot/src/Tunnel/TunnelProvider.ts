import type { TunnelProviderType } from "sbot.commons";

/** 单个 provider 的启动结果 */
export interface TunnelStartResult {
    /** 公网 URL；token tunnel 等不会主动暴露 URL 的场景可返回空串，由调用方按 status 字段处理 */
    publicUrl: string;
}

/**
 * Tunnel provider 抽象。每种穿透方案（cloudflare-quick / cloudflare-token / localtunnel）
 * 实现为一个独立类，由 {@link TunnelService} 单例按当前 settings.tunnel.provider 实例化。
 *
 * 注意：这不是插件机制（没有动态加载），只是普通的 OOP 多态。
 */
export interface TunnelProvider {
    readonly type: TunnelProviderType;

    start(localPort: number): Promise<TunnelStartResult>;
    stop(): Promise<void>;

    /** 进程或连接是否健康 */
    isHealthy(): boolean;

    /** 订阅日志行；返回取消订阅函数 */
    onLog(cb: (line: string) => void): () => void;

    /** 订阅意外退出（崩溃、断线）；用于 service 标记 error 状态 */
    onExit(cb: (reason: string) => void): () => void;
}
