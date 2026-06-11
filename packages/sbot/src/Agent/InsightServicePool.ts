import {
    IInsightExtractor, InsightExtractor,
    IInsightService, InsightService,
    IModelService,
    ILoggerService,
    ServiceContainer,
    T_InsightArchiveDays,
    T_InsightDir,
    T_InsightExtractorSystemPrompt,
    T_InsightStaleDays,
    T_InsightSystemPromptTemplate,
} from "scorpio.ai";
import { config } from "../Core/Config";
import { LoggerService } from "../Core/LoggerService";
import { loadPrompt } from "../Core/PromptLoader";

const logger = LoggerService.getLogger("Agent/InsightServicePool.ts");

/**
 * 进程内 InsightService 缓存：每个 insightId 共享一个实例。
 *
 * 为什么要 pool：
 * - InsightService 直接做文件 I/O（写 SKILL.md、归档 stale 项），多对话同时跑
 *   会有 TOCTOU 竞态（同名 insight 重复创建、curate 抢同一 rename）
 * - 内部 HybridSearcher 持有 `<insightDir>/.embeddings.json` 嵌入缓存；
 *   每个实例各自重算各自写，浪费 token + 末次写赢
 *
 * 共享一个实例后，文件操作天然在同一对象内串行。
 *
 * 失效时机：
 * - 用户编辑 / 删除 insightProfile 配置（settings CRUD afterSave / afterDelete）
 * - /api/reload（disposeAll）
 */
class InsightServicePool {
    private cache = new Map<string, IInsightService>();
    private pending = new Map<string, Promise<IInsightService>>();

    async get(insightId: string): Promise<IInsightService | null> {
        const cached = this.cache.get(insightId);
        if (cached) return cached;

        // 同一 insightId 同时多次 get：复用第一个 in-flight 的构造 Promise
        const inflight = this.pending.get(insightId);
        if (inflight) return inflight;

        const promise = this.build(insightId);
        this.pending.set(insightId, promise);
        try {
            const svc = await promise;
            this.cache.set(insightId, svc);
            return svc;
        } finally {
            this.pending.delete(insightId);
        }
    }

    invalidate(insightId: string): void {
        if (this.cache.delete(insightId)) {
            logger.info(`InsightService [${insightId}] invalidated`);
        }
    }

    disposeAll(): void {
        if (this.cache.size === 0) return;
        logger.info(`InsightService pool dispose ${this.cache.size} instance(s)`);
        this.cache.clear();
    }

    private async build(insightId: string): Promise<IInsightService> {
        const profile = config.getInsightProfile(insightId);
        if (!profile?.enabled) {
            throw new Error(`InsightProfile "${insightId}" not enabled or not found`);
        }
        const insightDir = config.getInsightPath(insightId);
        const extractorModel = await config.getModelService(profile.extractor, true);

        const sub = new ServiceContainer();
        sub.registerInstance(ILoggerService, { getLogger: (name: string) => LoggerService.getLogger(name) });
        sub.registerWithArgs(IInsightExtractor, InsightExtractor, {
            [IModelService]: extractorModel,
            [T_InsightExtractorSystemPrompt]: loadPrompt(profile.extractorPromptFile ?? 'insight/extractor/default.txt'),
        });
        sub.registerWithArgs(IInsightService, InsightService, {
            [T_InsightDir]: insightDir,
            [T_InsightSystemPromptTemplate]: loadPrompt('insight/system.txt'),
            [T_InsightStaleDays]: 30,
            [T_InsightArchiveDays]: 90,
        });
        return sub.resolve<IInsightService>(IInsightService);
    }
}

export const insightServicePool = new InsightServicePool();
