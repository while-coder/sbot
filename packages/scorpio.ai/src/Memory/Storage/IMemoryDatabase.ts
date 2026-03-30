import { Memory } from "../types";

/**
 * 记忆数据库接口
 * 定义记忆存储层的标准接口
 */
export interface IMemoryDatabase {
    // --- 查询 ---

    /**
     * 获取当前线程的所有记忆
     */
    getAllMemories(): Promise<Memory[]>;

    /**
     * 向量相似度搜索，带时间衰减评分
     */
    searchWithTimeDecay(
        queryEmbedding: number[],
        currentTime: number,
        decayFactor?: number,
        limit?: number
    ): Promise<Array<{ memory: Memory; distance: number; score: number; decayedScore: number }>>;

    /**
     * 查找重复记忆（cosine similarity >= threshold）
     * 返回最相似的一条，未找到返回 undefined
     */
    findDuplicate(
        queryEmbedding: number[],
        threshold?: number
    ): Promise<{ memory: Memory; score: number } | undefined>;

    // --- 写入 ---

    /**
     * 插入一条记忆
     */
    insertMemory(memory: Memory): Promise<void>;

    /**
     * 更新记忆的访问统计
     */
    updateAccess(memoryId: string): Promise<void>;

    /**
     * 删除指定记忆
     */
    deleteMemory(id: string): Promise<void>;

    /**
     * 清除当前线程的所有记忆
     * @returns 删除的记录数
     */
    clearMemories(): Promise<number>;

    /**
     * 清理过期且不重要的记忆
     * @returns 删除的记录数
     */
    pruneMemories(
        maxAge: number,
        minImportance?: number,
        minAccessCount?: number
    ): Promise<number>;

    // --- 生命周期 ---

    /**
     * 释放资源（如数据库连接）
     */
    dispose(): Promise<void>;
}

/**
 * IMemoryDatabase 的依赖注入 token
 */
export const IMemoryDatabase = Symbol("IMemoryDatabase");
