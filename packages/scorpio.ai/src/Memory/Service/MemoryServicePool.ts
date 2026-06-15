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
 * 按 memoryId 解析配置。返回 null 表示 profile 不存在或被禁用。
 * 必须同步——caller 在调用前需要把 model 工厂、prompt 文件加载等都 resolve 好。
 * 解析失败（如 model 拉不到）应抛错。
 */
export type MemoryServiceConfigResolver =
    (memoryId: string) => MemoryServiceConfig | null;

interface PoolEntry {
    service: IMemoryService;
    store: IMemoryStore;
}

/**
 * 进程内 MemoryService 缓存：每个 memoryId 共享一个实例。**单例**——通过
 * `MemoryServicePool.getInstance()`（或 named export `memoryServicePool`）拿。
 *
 * **必须使用 pool**——MemoryService 的"串行抽取 + 单实例 isRunning"语义只在
 * 同 memoryId 全局唯一实例下成立。直接 `new MemoryService(...)` 多次会让多个
 * 实例并发跑 LLM CRUD，破坏 store 数据。
 *
 * 生命周期模型（无 refCount，无 handle）：
 * - 第一次 `get(id)` / `acquire(id)` 时懒构造 + 缓存；之后稳定常驻
 * - profile 配置变更走 `invalidate(id)`：从 cache 移到 disposing；service 抽干 pending
 *   后回调 `notifyServiceIdle(id)`，pool 关 store
 * - 进程退出走 `disposeAll()`：批量 invalidate
 */
export class MemoryServicePool {
    private static _instance: MemoryServicePool | null = null;

    /** 拿单例（懒构造）。 */
    static getInstance(): MemoryServicePool {
        if (!this._instance) this._instance = new MemoryServicePool();
        return this._instance;
    }

    private cache = new Map<string, PoolEntry>();
    /** 已从 cache 摘掉、正在等 drain 完成的 entry；notifyServiceIdle 凭 memoryId 在这里找 store 关闭。 */
    private disposing = new Map<string, PoolEntry>();
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

    /** 拿 service 实例（懒构造 + 缓存）。无引用计数，caller 不需要释放。 */
    get(memoryId: string): IMemoryService | null {
        return this.getEntry(memoryId)?.service ?? null;
    }

    /** alias for `get` —— 保留语义化命名。 */
    acquire(memoryId: string): IMemoryService | null {
        return this.get(memoryId);
    }

    /**
     * profile 失效（编辑 / 删除）：先把 entry 摘出 cache 防止后续 get 命中老实例，
     * 再通知 service 抽干 pending；drain 完成后 service 回调 notifyServiceIdle 关 store。
     */
    invalidate(memoryId: string): void {
        const entry = this.cache.get(memoryId);
        if (!entry) return;
        this.cache.delete(memoryId);
        this.disposing.set(memoryId, entry);
        entry.service.dispose?.();
        this.logger?.info(`MemoryService [${memoryId}] invalidate requested`);
    }

    disposeAll(): void {
        if (this.cache.size === 0) return;
        for (const memoryId of [...this.cache.keys()]) {
            this.invalidate(memoryId);
        }
    }

    /** admin 触发：唤醒 pending 队列消费（不阻塞，UI 自行轮询 listPendingMessages 看进度）。 */
    forceExtract(memoryId: string): boolean {
        const entry = this.getEntry(memoryId);
        if (!entry) return false;
        entry.service.processPending();
        return true;
    }

    forceConsolidate(memoryId: string): Promise<MemoryWriterOpStats> | null {
        const entry = this.getEntry(memoryId);
        if (!entry) return null;
        return entry.service.consolidate();
    }

    listPendingMessages(memoryId: string, limit = 50): PendingMessageRow[] {
        const entry = this.getEntry(memoryId);
        if (!entry) return [];
        return entry.service.listPending(limit);
    }

    /**
     * 由 MemoryService 在"drain 完成 + dispose 已请求"时主动回调。
     * 在 disposing map 里查到 entry 才真正关 store；否则 no-op（service 已被替换或重建）。
     */
    notifyServiceIdle(memoryId: string): void {
        const entry = this.disposing.get(memoryId);
        if (!entry) return;
        this.disposing.delete(memoryId);
        entry.store.dispose();
        this.logger?.info(`MemoryService [${memoryId}] released`);
    }

    private getEntry(memoryId: string): PoolEntry | null {
        const cached = this.cache.get(memoryId);
        if (cached) return cached;

        const entry = this.build(memoryId);
        if (entry) this.cache.set(memoryId, entry);
        return entry;
    }

    private build(memoryId: string): PoolEntry | null {
        if (!this.resolveConfig) {
            throw new Error('MemoryServicePool: resolver not configured. Call setResolver() before use.');
        }
        const cfg = this.resolveConfig(memoryId);
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

        const store = sub.resolve<IMemoryStore>(IMemoryStore);
        const service = sub.resolve<IMemoryService>(IMemoryService);

        store.init();

        // 启动时跑一次 reconcile（异步，使用 fs/promises），不阻塞 build
        store.reconcile().then(stats => {
            if (stats.indexed > 0 || stats.pruned > 0) {
                this.logger?.info(`[${memoryId}] startup reconcile: indexed=${stats.indexed} pruned=${stats.pruned}`);
            }
        }).catch(e => {
            this.logger?.warn(`[${memoryId}] startup reconcile failed: ${e?.message ?? e}`);
        });

        // 启动时尝试消费历史 pending（上次进程崩溃前未处理的快照）
        service.processPending();
        this.logger?.info(`MemoryService [${memoryId}] built`);

        return { service, store };
    }
}

/** 包级单例，等同于 `MemoryServicePool.getInstance()`。 */
export const memoryServicePool = MemoryServicePool.getInstance();
