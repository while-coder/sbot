import path from "path";
import {
    MemoryServicePool,
    type MemoryServiceConfigResolver,
    type MemoryServiceHandle,
    type ILoggerService,
} from "scorpio.ai";
import { config } from "../Core/Config";
import { LoggerService } from "../Core/LoggerService";
import { loadPrompt } from "../Core/PromptLoader";

const DEFAULT_WRITER_PROMPT = "memory/writer/default.md";
const DEFAULT_READ_PROMPT   = "memory/reader/default.md";

/**
 * sbot 侧 MemoryServicePool 适配层。
 *
 * Pool 实现已上提到 scorpio.ai/Memory/Service/MemoryServicePool；这里只提供
 *   memoryId → MemoryServiceConfig 解析（profile / model / prompt 文件）。
 */
const resolveConfig: MemoryServiceConfigResolver = async (memoryId) => {
    const profile = config.getMemoryProfile(memoryId);
    if (!profile?.enabled) return null;
    if (!profile.writerModel) {
        throw new Error(`MemoryProfile "${memoryId}" missing writerModel`);
    }

    const writerModel = await config.getModelService(profile.writerModel, true);
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

const loggerService: ILoggerService = { getLogger: (name: string) => LoggerService.getLogger(name) };

export const memoryServicePool = new MemoryServicePool(resolveConfig, loggerService);
export type { MemoryServiceHandle };
