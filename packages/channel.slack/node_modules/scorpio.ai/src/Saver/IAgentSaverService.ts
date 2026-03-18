import { BaseMessage } from "langchain";

/**
 * Agent Saver 服务接口
 * 提供对话历史的持久化存储和检索功能
 */
export interface IAgentSaverService {
    // --- 基本属性 ---

    /**
     * 当前线程 ID
     */
    readonly threadId: string;

    // --- 查询 ---

    /**
     * 获取所有线程 ID 列表
     */
    getAllThreadIds(): Promise<string[]>;

    /**
     * 获取当前线程的全部历史消息（不限制 token）
     */
    getAllMessages(): Promise<BaseMessage[]>;

    /**
     * 获取当前线程的历史消息，从末尾截取不超过 maxTokens 的部分
     * 确保不破坏 tool_calls 和 ToolMessage 的配对
     * @param maxTokens 最大 token 数
     */
    getMessages(maxTokens: number): Promise<BaseMessage[]>;

    // --- 历史管理 ---

    /**
     * 向当前线程直接追加一条消息
     * @param message 要追加的消息
     */
    pushMessage(message: BaseMessage): Promise<void>;

    /**
     * 清除当前线程的所有历史记录
     */
    clearMessages(): Promise<void>;

    // --- 生命周期 ---

    /**
     * 释放资源（如数据库连接）
     */
    dispose(): Promise<void>;
}

/**
 * IAgentSaverService 的依赖注入 token
 * 使用 Symbol 确保唯一性，避免命名冲突
 */
export const IAgentSaverService = Symbol("IAgentSaverService");
