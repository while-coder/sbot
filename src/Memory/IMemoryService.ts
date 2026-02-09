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
     * 释放资源
     */
    dispose(): Promise<void>;
}

/**
 * IMemoryService 的依赖注入标识符
 */
export const IMemoryService = Symbol.for("IMemoryService");
