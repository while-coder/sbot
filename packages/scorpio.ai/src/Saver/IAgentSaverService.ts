import { BaseMessage } from "langchain";

export interface SaverMessage {
    message: BaseMessage;
    createdAt?: number;
    thinkId?: string;
}

/**
 * Agent Saver 服务接口
 * 提供对话历史的持久化存储和检索功能
 */
export interface IAgentSaverService {
    // --- 查询 ---

    /**
     * 获取全部历史消息
     */
    getAllMessages(): Promise<BaseMessage[]>;

    /**
     * 获取全部历史消息（带创建时间），用于 API 展示
     */
    getAllMessagesWithTime(): Promise<SaverMessage[]>;

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

    // --- Think ---

    /**
     * 获取指定 thinkId 对应的消息列表（含嵌套 think_id）
     * 若不存在或实现不支持则返回空数组
     */
    getThink(thinkId: string): Promise<SaverMessage[]>;

    /**
     * 向指定 thinkId 追加一条 think 消息
     * 用于将 sub-agent 的执行过程保存为 think
     */
    pushThinkMessage(thinkId: string, message: BaseMessage): Promise<void>;

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
