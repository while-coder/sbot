import path from "path";
import {
    IMemoryStore,
    MemoryStore,
    IMemoryService,
    MemoryService,
    IModelService,
    ILoggerService,
    ServiceContainer,
    T_MemoryDir,
    T_MemoryDbPath,
    T_MemoryReadTemplate,
    T_MemoryWriterPrompt,
    T_MemoryMenuMaxEntries,
    T_MemoryOnRelease,
    type MemoryWriterOpStats,
    type PendingMessageRow,
} from "scorpio.ai";
import { config } from "../Core/Config";
import { LoggerService } from "../Core/LoggerService";
import { loadPrompt } from "../Core/PromptLoader";

const logger = LoggerService.getLogger("Memory/MemoryServicePool");

const DEFAULT_WRITER_PROMPT = "memory/writer/default.md";
const DEFAULT_READ_PROMPT   = "memory/reader/default.md";

interface PoolEntry {
    service: IMemoryService;
    store: IMemoryStore;
    refCount: number;
}

export interface MemoryServiceHandle {
    service: IMemoryService;
    release(): Promise<void>;
}

/**
 * 进程内 MemoryService 缓存：每个 memoryProfile 共享一个实例。
 *
 * 释放生命周期：
 * 1. handle.release → pool.release：refCount-- ；若仍 >0 直接返回。
 * 2. refCount=0 → 调 service.requestRelease()，立即返回（不阻塞调用方）。
 * 3. service 内部 drain pending；drain 完成后回调构造时注入的 onRelease。
 * 4. onRelease（即 finalizeRelease）二次校验 refCount=0 后 store.dispose 并移出缓存。
 *
 * drain 期间若新的 acquire 抬高 refCount，finalizeRelease 检查到后放弃 dispose；
 * service 实例继续服务，下次 refCount 归零再走相同流程。
 */
class MemoryServicePool {
    private cache = new Map<string, PoolEntry>();
    private pending = new Map<string, Promise<PoolEntry>>();

    async get(memoryId: string): Promise<IMemoryService | null> {
        return (await this.getEntry(memoryId)).service;
    }

    async acquire(memoryId: string): Promise<MemoryServiceHandle | null> {
        const entry = await this.getEntry(memoryId);
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

    private async getEntry(memoryId: string): Promise<PoolEntry> {
        const cached = this.cache.get(memoryId);
        if (cached) return cached;

        const inflight = this.pending.get(memoryId);
        if (inflight) return await inflight;

        const promise = this.build(memoryId);
        this.pending.set(memoryId, promise);
        try {
            const entry = await promise;
            this.cache.set(memoryId, entry);
            return entry;
        } finally {
            this.pending.delete(memoryId);
        }
    }

    invalidate(memoryId: string): void {
        const entry = this.cache.get(memoryId);
        if (!entry) return;
        // 设置标志，由 service 抽干 pending 后回调 finalizeRelease 关闭 store
        entry.refCount = 0;
        entry.service.requestRelease?.();
        logger.info(`MemoryService [${memoryId}] invalidate requested`);
    }

    disposeAll(): void {
        if (this.cache.size === 0) return;
        for (const [memoryId, entry] of this.cache) {
            entry.refCount = 0;
            entry.service.requestRelease?.();
            logger.info(`MemoryService [${memoryId}] disposeAll requested`);
        }
    }

    /** admin 触发：阻塞等待 pending 队列消费完成。 */
    async forceExtract(memoryId: string): Promise<boolean> {
        const entry = await this.getEntry(memoryId);
        await entry.service.processPending();
        return true;
    }

    async forceConsolidate(memoryId: string): Promise<MemoryWriterOpStats> {
        const entry = await this.getEntry(memoryId);
        return entry.service.consolidate();
    }

    async listPendingMessages(memoryId: string, limit = 50): Promise<PendingMessageRow[]> {
        const entry = await this.getEntry(memoryId);
        return entry.service.listPending(limit);
    }

    private release(memoryId: string, entry: PoolEntry): void {
        if (this.cache.get(memoryId) !== entry) return;
        entry.refCount = Math.max(0, entry.refCount - 1);
        if (entry.refCount > 0) return;
        // 由 service 在 pending 队列抽干后回调 finalizeRelease 触发 store.dispose
        entry.service.requestRelease?.();
    }

    private finalizeRelease(memoryId: string, entry: PoolEntry): void {
        // drain 期间被新的 acquire 抬回去就放弃 dispose，service 继续服务
        if (entry.refCount > 0) return;
        if (this.cache.get(memoryId) !== entry) return;
        entry.store.dispose();
        this.cache.delete(memoryId);
        logger.info(`MemoryService [${memoryId}] released`);
    }

    private async build(memoryId: string): Promise<PoolEntry> {
        const profile = config.getMemoryProfile(memoryId);
        if (!profile?.enabled) {
            throw new Error(`MemoryProfile "${memoryId}" not enabled or not found`);
        }
        if (!profile.writerModel) {
            throw new Error(`MemoryProfile "${memoryId}" missing writerModel`);
        }

        const memoryDir = config.getMemoryPath(memoryId);
        const dbPath = path.join(memoryDir, "memory.db");

        const writerModel = await config.getModelService(profile.writerModel, true);
        if (!writerModel) throw new Error(`MemoryProfile "${memoryId}" writerModel "${profile.writerModel}" cannot be resolved`);

        const writerPrompt = loadPrompt(profile.writerPromptFile ?? DEFAULT_WRITER_PROMPT);
        const readTemplate = loadPrompt(profile.readPromptFile ?? DEFAULT_READ_PROMPT);

        // entry 引用先占位，等 service 注入 onRelease 闭包后再赋值；闭包通过引用穿透
        const entry: PoolEntry = { service: null as unknown as IMemoryService, store: null as unknown as IMemoryStore, refCount: 0 };
        const onRelease = () => this.finalizeRelease(memoryId, entry);

        const sub = new ServiceContainer();
        const loggerProvider: ILoggerService = { getLogger: (name: string) => LoggerService.getLogger(name) };
        sub.registerInstance(ILoggerService, loggerProvider);
        sub.registerInstance(T_MemoryReadTemplate, readTemplate);
        sub.registerInstance(T_MemoryWriterPrompt, writerPrompt);
        sub.registerInstance(T_MemoryMenuMaxEntries, profile.writerMemoryMenuMaxEntries ?? 200);
        sub.registerInstance(T_MemoryOnRelease, onRelease);
        sub.registerInstance(IModelService, writerModel);
        sub.registerWithArgs(IMemoryStore, MemoryStore, {
            [T_MemoryDir]:    memoryDir,
            [T_MemoryDbPath]: dbPath,
        });
        sub.registerSingleton(IMemoryService, MemoryService);

        const store = await sub.resolve<IMemoryStore>(IMemoryStore);
        const service = await sub.resolve<IMemoryService>(IMemoryService);
        entry.store = store;
        entry.service = service;

        await store.init();
        // 启动时跑一次 reconcile，吸收外部进程对 memories/*.md 的修改
        try {
            const stats = await store.reconcile();
            if (stats.indexed > 0 || stats.pruned > 0) {
                logger.info(`[${memoryId}] startup reconcile: indexed=${stats.indexed} pruned=${stats.pruned}`);
            }
        } catch (e: any) {
            logger.warn(`[${memoryId}] startup reconcile failed: ${e?.message ?? e}`);
        }

        // 启动时尝试消费历史 pending（上次进程崩溃前未处理的快照），不阻塞 build
        service.processPending().catch(e => {
            logger.warn(`[${memoryId}] startup pending drain failed: ${e?.message ?? e}`);
        });
        logger.info(`MemoryService [${memoryId}] built`);

        return entry;
    }
}

export const memoryServicePool = new MemoryServicePool();
