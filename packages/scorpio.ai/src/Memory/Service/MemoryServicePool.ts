import { ServiceContainer } from "scorpio.di";
import {
    T_MemoryDir,
    T_MemoryDbPath,
    T_MemoryReadTemplate,
    T_MemoryWriterPrompt,
    T_MemoryMenuMaxEntries,
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
 * 按 memoryId 解析配置。返回 null 表示 profile 不存在或被禁用。
 * 必须同步——caller 在调用前需要把 model 工厂、prompt 文件加载等都 resolve 好。
 * 解析失败（如 model 拉不到）应抛错。
 */
export type MemoryServiceConfigResolver =
    (memoryId: string) => MemoryServiceConfig | null;

/**
 * 进程内 MemoryService 缓存：每个 memoryId 共享一个实例。**单例**——通过
 * `MemoryServicePool.getInstance()`（或 named export `memoryServicePool`）拿。
 *
 * **必须使用 pool**——MemoryService 的"串行抽取 + 单实例 isRunning"语义只在
 * 同 memoryId 全局唯一实例下成立。直接 `new MemoryService(...)` 多次会让多个
 * 实例并发跑 LLM CRUD，破坏 store 数据。
 *
 * 生命周期模型（纯 refCount，无强制销毁）：
 * - acquire(id)：cache miss → build 新实例 + 注册 onDispose 自驱逐；命中实例 incRef
 *   后返回；调用方用完后 service.release() 配对归还
 * - refCount 归零自动 teardown：关 SQLite store + 调 onDispose 把自己从 cache 删掉
 * - drain（checkMessages）自固定 refCount，drain 期间 caller release 不会触发 teardown
 * - invalidate(id) / invalidateAll()：仅 cache.delete，不动 refCount —— 已 acquire 的
 *   实例继续服务到 refCount 归零；下次 acquire 同 id 拿到全新实例（profile 配置变更场景）
 */
export class MemoryServicePool {
    private static _instance: MemoryServicePool | null = null;

    /** 拿单例（懒构造）。 */
    static getInstance(): MemoryServicePool {
        if (!this._instance) this._instance = new MemoryServicePool();
        return this._instance;
    }

    private cache = new Map<string, MemoryService>();
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

    /**
     * 拿一个 service 引用并 incRef。caller 用完务必调 `service.release()`。
     * cache 中只可能有"还活着"的 service —— refCount 归零的 service 会通过 onDispose
     * 自我从 cache 移除，所以这里直接 get 就行。
     */
    acquire(memoryId: string): IMemoryService | null {
        let service = this.cache.get(memoryId);
        if (!service) {
            service = this.build(memoryId) ?? undefined;
            if (!service) return null;
        }
        service.incRef();
        // incRef 之后再 kick drain：drain 自固定的引用是叠加在 caller 的 1 之上，
        // 即便队列空导致 drain 立刻 release，refCount 也不会落到 0。
        service.processPending();
        return service;
    }

    /**
     * profile 失效（编辑 / 删除）：仅从 cache 摘除。已 acquire 的实例继续服务到
     * refCount 归零；下次 acquire 同 id 会构建新实例（吃到新配置）。
     */
    invalidate(memoryId: string): void {
        if (this.cache.delete(memoryId)) {
            this.logger?.info(`MemoryService [${memoryId}] invalidated`);
        }
    }

    /** 配置整体 reload 时清空 cache。语义同逐个 invalidate。 */
    invalidateAll(): void {
        if (this.cache.size === 0) return;
        for (const id of this.cache.keys()) {
            this.logger?.info(`MemoryService [${id}] invalidated (all)`);
        }
        this.cache.clear();
    }

    /** Service 自驱逐：refCount 归零 teardown 完成后由 service.release() 调进来。
     *  identity 检查避免误删被 invalidate 后重建的同 id 新实例。 */
    evict(service: MemoryService): void {
        for (const [id, cached] of this.cache) {
            if (cached === service) {
                this.cache.delete(id);
                this.logger?.info(`MemoryService [${id}] disposed`);
                return;
            }
        }
    }

    /** admin 触发：唤醒 pending 队列消费（不阻塞，UI 自行轮询 listPendingMessages 看进度）。 */
    forceExtract(memoryId: string): boolean {
        const service = this.acquire(memoryId);
        if (!service) return false;
        try { service.processPending(); return true; }
        finally { service.release(); }
    }

    async forceConsolidate(memoryId: string): Promise<MemoryWriterOpStats | null> {
        const service = this.acquire(memoryId);
        if (!service) return null;
        try { return await service.consolidate(); }
        finally { service.release(); }
    }

    listPendingMessages(memoryId: string, limit = 50): PendingMessageRow[] {
        const service = this.acquire(memoryId);
        if (!service) return [];
        try { return service.listPending(limit); }
        finally { service.release(); }
    }

    private build(memoryId: string): MemoryService | null {
        if (!this.resolveConfig) {
            throw new Error('MemoryServicePool: resolver not configured. Call setResolver() before use.');
        }
        const cfg = this.resolveConfig(memoryId);
        if (!cfg) return null;

        const sub = new ServiceContainer();
        if (this.loggerService) sub.registerInstance(ILoggerService, this.loggerService);
        sub.registerInstance(T_MemoryReadTemplate, cfg.readTemplate);
        sub.registerInstance(T_MemoryWriterPrompt, cfg.writerPrompt);
        sub.registerInstance(T_MemoryMenuMaxEntries, cfg.menuMaxEntries ?? 200);
        sub.registerInstance(IModelService, cfg.writerModel);
        sub.registerWithArgs(IMemoryStore, MemoryStore, {
            [T_MemoryDir]:    cfg.memoryDir,
            [T_MemoryDbPath]: cfg.dbPath,
        });
        sub.registerSingleton(IMemoryService, MemoryService);

        const store = sub.resolve<IMemoryStore>(IMemoryStore);
        const service = sub.resolve<MemoryService>(IMemoryService) as MemoryService;

        this.cache.set(memoryId, service);

        store.init();

        // 启动时跑一次 reconcile（异步，使用 fs/promises），不阻塞 build
        store.reconcile().then(stats => {
            if (stats.indexed > 0 || stats.pruned > 0) {
                this.logger?.info(`[${memoryId}] startup reconcile: indexed=${stats.indexed} pruned=${stats.pruned}`);
            }
        }).catch(e => {
            this.logger?.warn(`[${memoryId}] startup reconcile failed: ${e?.message ?? e}`);
        });

        // 历史 pending 由 acquire 在 incRef 之后 kick；这里不再 processPending，
        // 否则 drain 自固定结束时会自我 teardown（caller 还没 incRef）。
        this.logger?.info(`MemoryService [${memoryId}] built`);

        return service;
    }
}

/** 包级单例，等同于 `MemoryServicePool.getInstance()`。 */
export const memoryServicePool = MemoryServicePool.getInstance();
