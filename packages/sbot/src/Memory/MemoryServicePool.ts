import path from "path";
import {
    memoryServicePool,
    type MemoryServiceConfigResolver,
} from "scorpio.ai";
import { config } from "../Core/Config";
import { LoggerService } from "../Core/LoggerService";
import { loadPrompt } from "../Core/PromptLoader";

const DEFAULT_WRITER_PROMPT = "memory/writer/default.md";
const DEFAULT_READ_PROMPT   = "memory/reader/default.md";

/**
 * sbot 侧 MemoryServicePool 适配层。
 *
 * Pool 单例已在 scorpio.ai 内创建，这里只负责注入 sbot 特有的解析逻辑：
 *   memoryId → MemoryServiceConfig（profile / model / prompt 文件）
 */
const resolveConfig: MemoryServiceConfigResolver = (memoryId) => {
    const profile = config.getMemoryProfile(memoryId);
    if (!profile?.enabled) return null;
    if (!profile.writerModel) {
        throw new Error(`MemoryProfile "${memoryId}" missing writerModel`);
    }

    const writerModel = config.getModelService(profile.writerModel, true);
    if (!writerModel) {
        throw new Error(`MemoryProfile "${memoryId}" writerModel "${profile.writerModel}" cannot be resolved`);
    }

    const memoryDir = config.getMemoryPath(memoryId);
    return {
        memoryDir,
        dbPath: path.join(memoryDir, "memory.db"),
        writerModel,
        writerPrompt: loadPrompt(profile.writerPromptFile ?? DEFAULT_WRITER_PROMPT),
        readTemplate: loadPrompt(profile.readPromptFile ?? DEFAULT_READ_PROMPT),
        menuMaxEntries: profile.writerMemoryMenuMaxEntries,
    };
};

memoryServicePool.setResolver(resolveConfig);
memoryServicePool.setLoggerService({ getLogger: (name: string) => LoggerService.getLogger(name) });

const logger = LoggerService.getLogger("Memory/MemoryServicePool.ts");

/**
 * 启动时对所有已启用的 memoryProfile 触发一次 forceExtract，把上次进程残留的
 * pending 抽取队列消化掉，避免依赖第一次对话或 admin 手动按钮。
 * forceExtract 内部 drain 自固定 refCount，立即返回，后台串行跑 LLM。
 */
export function startupExtractAll(): void {
    const profiles = config.settings.memoryProfiles ?? {};
    let triggered = 0;
    for (const [id, profile] of Object.entries(profiles)) {
        if (!profile?.enabled) continue;
        try {
            if (memoryServicePool.forceExtract(id)) triggered++;
        } catch (e: any) {
            logger.warn(`Memory startup extract [${id}] failed: ${e?.message ?? String(e)}`);
        }
    }
    if (triggered > 0) logger.info(`Memory startup extract triggered for ${triggered} profile(s)`);
}

export { memoryServicePool };
