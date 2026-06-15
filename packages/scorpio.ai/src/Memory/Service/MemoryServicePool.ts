import { ServiceContainer } from "scorpio.di";
import {
    T_MemoryDir,
    T_MemoryDbPath,
    T_MemoryReadTemplate,
    T_MemoryWriterPrompt,
    T_MemoryMenuMaxEntries,
    T_MemoryId,
} from "../../Core/tokens";
import { ILogger, ILoggerService } from "../../Logger";
import { IModelService } from "../../Model";
import { IMemoryStore } from "../Storage/IMemoryStore";
import { MemoryStore } from "../Storage/MemoryStore";
import { IMemoryService, type MemoryWriterOpStats } from "./IMemoryService";
import { MemoryService } from "./MemoryService";
import type { PendingMessageRow } from "../Storage/IMemoryStore";

/**
 * 由 caller resolver 提供的、构造一个 MemoryService 所需的全部"已 resolved 配置"。
 * 文件 IO（读 prompt 文件）、模型工厂（modelId → IModelService）、目录解析这些
 * 应用层概念都由 caller 完成，pool 不参与。
 */
export interface MemoryServiceConfig {
    /** memory 根目录（含 `memories/<slug>.md` 与 `.archive/`） */
    memoryDir: string;
    /** SQLite 文件绝对路径（含 memories 索引 + memory_pending_messages 队列） */
    dbPath: string;
    /** MemoryWriter 用的 model 实例 */
    writerModel: IModelService;
    /** 已加载的 MemoryWriter system prompt 字符串 */
    writerPrompt: string;
    /** 已加载的 read 模板字符串（含 `{{ memory_menu }}` 占位符） */
    readTemplate: string;
    /** Writer 注入 menu 时的最大条目数，默认 200 */
    menuMaxEntries?: number;
}

/**
 * 按 memoryId 解析配置。返回 null 表示 profile 不存在或被禁用，pool 据此返回 null handle。
 * 解析失败（如 model 拉不到）应抛错。
 */
export type MemoryServiceConfigResolver =
    (memoryId: string) => Promise<MemoryServiceConfig | null>;

export interface MemoryServiceHandle {
    service: IMemoryService;
    release(): Promise<void>;
}

interface PoolEntry {
    service: IMemoryService;
    store: IMemoryStore;
    refCount: number;
}

/**
 * 进程内 MemoryService 缓存：每个 memoryId 共享一个实例。**单例**——通过
 * `MemoryServicePool.getInstance()`（或 named export `memoryServicePool`）拿。
 *
 * 使用方式：
 *   import { memoryServicePool } from 'scorpio.ai';
 *   memoryServicePool.setResolver(async memoryId => { ... });
 *   memoryServicePool.setLoggerService(loggerProvider);   // 可选
 *
 * **必须使用 pool**——MemoryService 的"串行抽取 + 单实例 isRunning"语义只在
 * 同 memoryId 全局唯一实例下成立。直接 `new MemoryService(...)` 多次会让多个
 * 实例并发跑 LLM CRUD，破坏 store 数据。
 *
 * 释放生命周期：
 * 1. handle.release → pool.release：refCount-- ；若仍 >0 直接返回。
 * 2. refCount=0 → 调 service.requestRelease()，立即返回（不阻塞调用方）。
 * 3. service 内部 drain pending；drain 完成 + releaseRequested 时回调
 *    `pool.notifyServiceIdle(memoryId)` 触发 finalize。
 * 4. notifyServiceIdle 二次校验 refCount=0 + cache 命中后 store.dispose 并移出缓存。
 *
 * drain 期间若新的 acquire 抬高 refCount，notifyServiceIdle 检查到后放弃 dispose；
 * service 实例继续服务，下次 refCount 归零再走相同流程。
 */
export class MemoryServicePool {
    private static _instance: MemoryServicePool | null = null;

    /** 拿单例（懒构造）。 */
    static getInstance(): MemoryServicePool {
        if (!this._instance) this._instance = new MemoryServicePool();
        return this._instance;
    }

    private cache = new Map<string, PoolEntry>();
    private pending = new Map<string, Promise<PoolEntry | null>>();
    private resolveConfig?: MemoryServiceConfigResolver;
    private loggerService?: ILoggerService;
    private logger?: ILogger;

    private constructor() {}

    /** 配置 memoryId → MemoryServiceConfig 解析器；必须在第一次 acquire/get 之前调用。 */
    setResolver(resolver: MemoryServiceConfigResolver): void {
        this.resolveConfig = resolver;
    }

    /** 配置 logger service（可选）。 */
    setLoggerService(svc: ILoggerService): void {
        this.loggerService = svc;
        this.logger = svc.getLogger("MemoryServicePool");
    }

    async get(memoryId: string): Promise<IMemoryService | null> {
        const entry = await this.getEntry(memoryId);
        return entry?.service ?? null;
    }

    async acquire(memoryId: string): Promise<MemoryServiceHandle | null> {
        const entry = await this.getEntry(memoryId);
        if (!entry) return null;
        entry.refCount++;
        let released = false;
        return {
            service: entry.service,
            release: async () => {
                if (released) return;
                released = true;
                this.release(memoryId, entry);
            },
        };
    }

    invalidate(memoryId: string): void {
        const entry = this.cache.get(memoryId);
        if (!entry) return;
        // 设置标志，由 service 抽干 pending 后回调 notifyServiceIdle 关闭 store
        entry.refCount = 0;
        entry.service.requestRelease?.();
        this.logger?.info(`MemoryService [${memoryId}] invalidate requested`);
    }

    disposeAll(): void {
        if (this.cache.size === 0) return;
        for (const [memoryId, entry] of this.cache) {
            entry.refCount = 0;
            entry.service.requestRelease?.();
            this.logger?.info(`MemoryService [${memoryId}] disposeAll requested`);
        }
    }

    /** admin 触发：唤醒 pending 队列消费（不阻塞，UI 自行轮询 listPendingMessages 看进度）。 */
    async forceExtract(memoryId: string): Promise<boolean> {
        const entry = await this.getEntry(memoryId);
        if (!entry) return false;
        entry.service.processPending();
        return true;
    }

    async forceConsolidate(memoryId: string): Promise<MemoryWriterOpStats | null> {
        const entry = await this.getEntry(memoryId);
        if (!entry) return null;
        return entry.service.consolidate();
    }

    async listPendingMessages(memoryId: string, limit = 50): Promise<PendingMessageRow[]> {
        const entry = await this.getEntry(memoryId);
        if (!entry) return [];
        return entry.service.listPending(limit);
    }

    /**
     * 由 MemoryService 在"drain 完成 + releaseRequested"时主动回调。
     * 二次校验后真正 dispose store + 移出缓存；否则放弃释放，service 继续服务。
     */
    notifyServiceIdle(memoryId: string): void {
        const entry = this.cache.get(memoryId);
        if (!entry) return;
        // drain 期间被新的 acquire 抬回去就放弃 dispose，service 继续服务
        if (entry.refCount > 0) return;
        entry.store.dispose();
        this.cache.delete(memoryId);
        this.logger?.info(`MemoryService [${memoryId}] released`);
    }

    private async getEntry(memoryId: string): Promise<PoolEntry | null> {
        const cached = this.cache.get(memoryId);
        if (cached) return cached;

        const inflight = this.pending.get(memoryId);
        if (inflight) return await inflight;

        const promise = this.build(memoryId);
        this.pending.set(memoryId, promise);
        try {
            const entry = await promise;
            if (entry) this.cache.set(memoryId, entry);
            return entry;
        } finally {
            this.pending.delete(memoryId);
        }
    }

    private release(memoryId: string, entry: PoolEntry): void {
        if (this.cache.get(memoryId) !== entry) return;
        entry.refCount = Math.max(0, entry.refCount - 1);
        if (entry.refCount > 0) return;
        // 由 service 在 pending 队列抽干后回调 notifyServiceIdle 触发 store.dispose
        entry.service.requestRelease?.();
    }

    private async build(memoryId: string): Promise<PoolEntry | null> {
        if (!this.resolveConfig) {
            throw new Error('MemoryServicePool: resolver not configured. Call setResolver() before use.');
        }
        const cfg = await this.resolveConfig(memoryId);
        if (!cfg) return null;

        const sub = new ServiceContainer();
        if (this.loggerService) sub.registerInstance(ILoggerService, this.loggerService);
        sub.registerInstance(T_MemoryId, memoryId);
        sub.registerInstance(T_MemoryReadTemplate, cfg.readTemplate);
        sub.registerInstance(T_MemoryWriterPrompt, cfg.writerPrompt);
        sub.registerInstance(T_MemoryMenuMaxEntries, cfg.menuMaxEntries ?? 200);
        sub.registerInstance(IModelService, cfg.writerModel);
        sub.registerWithArgs(IMemoryStore, MemoryStore, {
            [T_MemoryDir]:    cfg.memoryDir,
            [T_MemoryDbPath]: cfg.dbPath,
        });
        sub.registerSingleton(IMemoryService, MemoryService);

        const store = await sub.resolve<IMemoryStore>(IMemoryStore);
        const service = await sub.resolve<IMemoryService>(IMemoryService);

        const entry: PoolEntry = { service, store, refCount: 0 };

        await store.init();
        // 启动时跑一次 reconcile，吸收外部进程对 memories/*.md 的修改
        try {
            const stats = await store.reconcile();
            if (stats.indexed > 0 || stats.pruned > 0) {
                this.logger?.info(`[${memoryId}] startup reconcile: indexed=${stats.indexed} pruned=${stats.pruned}`);
            }
        } catch (e: any) {
            this.logger?.warn(`[${memoryId}] startup reconcile failed: ${e?.message ?? e}`);
        }

        // 启动时尝试消费历史 pending（上次进程崩溃前未处理的快照），不阻塞 build
        service.processPending();
        this.logger?.info(`MemoryService [${memoryId}] built`);

        return entry;
    }
}

/** 包级单例，等同于 `MemoryServicePool.getInstance()`。 */
export const memoryServicePool = MemoryServicePool.getInstance();
