/**
 * 记忆服务接口
 */
export interface IMemoryService {
    /**
     * 获取记忆摘要（用于注入到 prompt）
     */
    getMemorySummary(query: string, maxTokens?: number): Promise<string>;

    /**
     * 对话历史记忆化
     */
    memorizeConversation(userMessage: string, assistantMessage: string, importance?: number): Promise<void>;

    /**
     * 压缩相似记忆（需要 MemoryCompressor 可用）
     */
    compressMemories(): Promise<number>;

    /**
     * 清除用户的所有记忆
     * @returns 删除的记忆条数
     */
    clearAll(): Promise<number>;

    /**
     * 释放资源
     */
    dispose(): Promise<void>;
}

/**
 * IMemoryService 的依赖注入标识符
 */
export const IMemoryService = Symbol.for("IMemoryService");
