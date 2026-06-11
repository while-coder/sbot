import path from "path";
import {
    IMemoryStore,
    MemoryStore,
    IMemoryService,
    MemoryService,
    MemoryWriterWorker,
    SecretRedactor,
    IModelService,
    ILoggerService,
    ServiceContainer,
    T_MemoryDir,
    T_MemoryDbPath,
    T_MemoryReadTemplate,
} from "scorpio.ai";
import { config } from "../Core/Config";
import { LoggerService } from "../Core/LoggerService";
import { loadPrompt } from "../Core/PromptLoader";
import { MemoryExtractScheduler } from "./MemoryExtractScheduler";

const logger = LoggerService.getLogger("Memory/MemoryServicePool");

const DEFAULT_WRITER_PROMPT = "memory/memory_write.md";
const DEFAULT_READ_PROMPT   = "memory/memory_read.md";

interface PoolEntry {
    service: IMemoryService;
    store: IMemoryStore;
    worker: MemoryWriterWorker;
    scheduler: MemoryExtractScheduler;
}

/**
 * 进程内 MemoryService 缓存：每个 memoryProfile 共享一个实例。
 *
 * 每个 memoryId 绑定的资源：
 * - 独立 SQLite 文件 `<memoryDir>/memory.db`（memories 索引 + 抽取队列）
 * - 独立 memories/ 目录
 * - 一个 MemoryService（getMemoryMenuPrompt / readMemory / search）
 * - 一个后台 MemoryExtractScheduler（每 60s 扫 idle session 抽取记忆）
 *
 * 失效时机：
 * - 用户编辑 / 删除 memoryProfile 配置（settings CRUD afterSave / afterDelete）
 * - /api/reload（disposeAll）
 */
class MemoryServicePool {
    private cache = new Map<string, PoolEntry>();
    private pending = new Map<string, Promise<PoolEntry>>();

    async get(memoryId: string): Promise<IMemoryService | null> {
        const cached = this.cache.get(memoryId);
        if (cached) return cached.service;

        const inflight = this.pending.get(memoryId);
        if (inflight) return (await inflight).service;

        const promise = this.build(memoryId);
        this.pending.set(memoryId, promise);
        try {
            const entry = await promise;
            this.cache.set(memoryId, entry);
            return entry.service;
        } finally {
            this.pending.delete(memoryId);
        }
    }

    invalidate(memoryId: string): void {
        const entry = this.cache.get(memoryId);
        if (!entry) return;
        entry.scheduler.stop();
        entry.store.dispose();
        this.cache.delete(memoryId);
        logger.info(`MemoryService [${memoryId}] invalidated`);
    }

    disposeAll(): void {
        if (this.cache.size === 0) return;
        for (const entry of this.cache.values()) {
            entry.scheduler.stop();
            entry.store.dispose();
        }
        logger.info(`MemoryService pool dispose ${this.cache.size} instance(s)`);
        this.cache.clear();
    }

    /** admin 手动触发一次扫描 + 抽取（绕过 60s tick）。返回 true 表示真的跑了。 */
    async forceExtract(memoryId: string): Promise<boolean> {
        await this.get(memoryId);  // 确保 entry 已构造
        const entry = this.cache.get(memoryId);
        if (!entry) return false;
        await entry.scheduler.runOnce();
        return true;
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

        // DI 子容器：MemoryStore + MemoryService。Worker 直接 new（依赖 model service）。
        const sub = new ServiceContainer();
        const loggerProvider: ILoggerService = { getLogger: (name: string) => LoggerService.getLogger(name) };
        sub.registerInstance(ILoggerService, loggerProvider);
        sub.registerInstance(T_MemoryReadTemplate, readTemplate);
        sub.registerWithArgs(IMemoryStore, MemoryStore, {
            [T_MemoryDir]:    memoryDir,
            [T_MemoryDbPath]: dbPath,
        });
        sub.registerSingleton(IMemoryService, MemoryService);

        const store = await sub.resolve<IMemoryStore>(IMemoryStore);
        const service = await sub.resolve<IMemoryService>(IMemoryService);

        // 目录就位 + DB schema 初始化
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

        const worker = new MemoryWriterWorker(
            writerModel as IModelService,
            store,
            writerPrompt,
            new SecretRedactor(),
            loggerProvider,
        );

        const scheduler = new MemoryExtractScheduler(memoryId, profile, store, worker);
        scheduler.start();
        logger.info(`MemoryService [${memoryId}] built; extract scheduler started`);

        return { service, store, worker, scheduler };
    }
}

export const memoryServicePool = new MemoryServicePool();
