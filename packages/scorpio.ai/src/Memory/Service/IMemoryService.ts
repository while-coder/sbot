import { Memory, MemoryResult } from "../types";

/**
 * 记忆服务接口（资料库模式）
 * 提供语义搜索和手动写入能力，不主动从对话中提取记忆
 */
export interface IMemoryService {
    // ── 读取 ──────────────────────────────────────────────────────────────────

    getMemories(query: string, limit?: number): Promise<MemoryResult[]>;

    getAllMemories(): Promise<Memory[]>;

    // ── 写入 ──────────────────────────────────────────────────────────────────

    /**
     * 直接插入一段完整记忆，跳过 Extractor
     * 大文本会自动按字符切割后分批插入（可通过 options.autoSplit 禁用）
     */
    addMemoryDirect(content: string, options?: { autoSplit?: boolean }): Promise<string[]>;

    // ── 维护 ──────────────────────────────────────────────────────────────────

    deleteMemory(memoryId: string): Promise<void>;

    clearAll(): Promise<number>;

    // ── 生命周期 ──────────────────────────────────────────────────────────────

    dispose(): Promise<void>;
}

export const IMemoryService = Symbol("IMemoryService");
