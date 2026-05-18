import { Memory, MemoryResult } from "../types";

/**
 * 记忆数据库接口（资料库模式）
 */
export interface IMemoryDatabase {
    // --- 查询 ---

    getAllMemories(): Promise<Memory[]>;

    searchWithTimeDecay(
        queryEmbedding: number[],
        currentTime: number,
        decayFactor?: number,
        limit?: number
    ): Promise<MemoryResult[]>;

    findDuplicate(
        queryEmbedding: number[],
        threshold?: number
    ): Promise<{ memory: Memory; score: number } | undefined>;

    // --- 写入 ---

    insertMemory(memory: Memory): Promise<void>;

    updateAccess(memoryId: string): Promise<void>;

    deleteMemory(id: string): Promise<void>;

    clearMemories(): Promise<number>;

    // --- 生命周期 ---

    dispose(): Promise<void>;
}

export const IMemoryDatabase = Symbol("IMemoryDatabase");
