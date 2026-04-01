// ─── Neutral message types (no LangChain dependency) ────────────────────────

export enum MessageRole {
    Human = 'human',
    AI    = 'ai',
    Tool  = 'tool',
}

export interface ChatToolCall {
    id?: string;
    name: string;
    args: Record<string, any>;
    type?: string;
}

/**
 * 中性化的消息结构，不依赖任何 LLM 框架
 *
 * - human : 用户输入
 * - ai    : 模型输出（可含 tool_calls）
 * - tool  : 工具执行结果（含 tool_call_id）
 */
export interface ChatMessage {
    role: MessageRole;
    content: string | Array<{ type: string; text?: string; [key: string]: any }>;
    /** AI 消息发起的工具调用列表 */
    tool_calls?: ChatToolCall[];
    /** Tool 消息关联的 tool_call_id */
    tool_call_id?: string;
    /** Tool 消息的工具名 */
    name?: string;
    /** Tool 消息的执行状态（success / error） */
    status?: string;
    /** 消息唯一 ID */
    id?: string;
    additional_kwargs?: Record<string, any>;
}

// ─── Push options ────────────────────────────────────────────────────────────

export interface ChatMessageOptions {
    /** 关联的 think 记录 ID（由 ReAct 子 Agent 执行时携带） */
    thinkId?: string;
}

// ─── Storage row wrapper ─────────────────────────────────────────────────────

export interface StoredMessage {
    message: ChatMessage;
    createdAt?: number;
    thinkId?: string;
}

// ─── Interface ───────────────────────────────────────────────────────────────

/**
 * Agent Saver 服务接口
 * 提供对话历史的持久化存储和检索功能
 */
export interface IAgentSaverService {
    // --- 查询 ---

    /**
     * 获取全部历史消息（含元数据），用于历史展示或内部处理
     */
    getAllMessages(): Promise<StoredMessage[]>;

    /**
     * 获取当前线程的历史消息，从末尾截取不超过 maxTokens 的部分
     * 确保不破坏 tool_calls 和 tool 消息的配对
     * @param maxTokens 最大 token 数
     */
    getMessages(maxTokens: number): Promise<ChatMessage[]>;

    // --- 历史管理 ---

    /**
     * 向当前线程直接追加一条消息
     * @param message 要追加的消息
     * @param options 可选的附加选项
     */
    pushMessage(message: ChatMessage, options?: ChatMessageOptions): Promise<void>;

    /**
     * 清除当前线程的所有历史记录
     */
    clearMessages(): Promise<void>;

    // --- Think ---

    /**
     * 获取指定 thinkId 对应的消息列表（含嵌套 think_id）
     * 若不存在或实现不支持则返回空数组
     */
    getThink(thinkId: string): Promise<StoredMessage[]>;

    /**
     * 向指定 thinkId 追加一条 think 消息
     * 用于将 sub-agent 的执行过程保存为 think
     */
    pushThinkMessage(thinkId: string, message: ChatMessage, options?: ChatMessageOptions): Promise<void>;

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
