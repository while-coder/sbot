import { Memory, MemoryResult } from "../types";

/**
 * 记忆服务接口
 * 定义记忆管理的标准接口
 */
export interface IMemoryService {
    // ── 读取 ──────────────────────────────────────────────────────────────────

    /**
     * 检索与查询相关的记忆，返回记忆内容列表；无记忆时返回空数组
     */
    getMemories(query: string, limit?: number): Promise<MemoryResult[]>;

    /**
     * 获取所有记忆
     */
    getAllMemories(): Promise<Memory[]>;

    // ── 写入 ──────────────────────────────────────────────────────────────────

    /**
     * 对话历史记忆化
     * @param userMessage 用户消息
     * @param assistantMessage 助手消息（MemoryMode.HUMAN_ONLY 时可不传）
     */
    memorizeConversation(userMessage: string, assistantMessage?: string[]): Promise<void>;

    /**
     * 直接插入一段完整记忆，跳过 Extractor
     * 大文本会自动按字符切割后分批插入（可通过 options.autoSplit 禁用）
     * @param content 记忆内容
     * @param options.autoSplit 是否自动分割，默认 true
     * @param options.importance 重要性分数 0-1，默认 0.5
     * @returns 插入的记忆 ID 数组
     */
    addMemoryDirect(content: string, options?: { autoSplit?: boolean; importance?: number }): Promise<string[]>;

    // ── 维护 ──────────────────────────────────────────────────────────────────

    /**
     * 删除指定记忆
     */
    deleteMemory(memoryId: string): Promise<void>;

    /**
     * 压缩相似记忆（需要 MemoryCompressor 可用）
     */
    compressMemories(): Promise<number>;

    /**
     * 清除用户的所有记忆
     * @returns 删除的记忆条数
     */
    clearAll(): Promise<number>;

    // ── 生命周期 ──────────────────────────────────────────────────────────────

    /**
     * 释放资源
     */
    dispose(): Promise<void>;
}

/**
 * IMemoryService 的依赖注入 token
 * 使用 Symbol 确保唯一性，避免命名冲突
 */
export const IMemoryService = Symbol("IMemoryService");
