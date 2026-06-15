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

export { memoryServicePool };
