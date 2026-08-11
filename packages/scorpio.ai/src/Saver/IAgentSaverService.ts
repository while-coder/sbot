import type { ChatMessage } from "scorpio.llm";

export { MessageRole, ContentPartType } from "scorpio.llm";
export type {
    AttachmentInput,
    ChatMessage,
    ChatToolCall,
    ContentPart,
    MessageContent,
    TokenUsage,
} from "scorpio.llm";

// ─── Push options ────────────────────────────────────────────────────────────

export interface ChatMessageOptions {
    /** 关联的 think 记录 ID（由 ReAct 子 Agent 执行时携带） */
    thinkId?: string;
    /** 关联的 task ID（即子 Agent 的持久会话身份）。由 ReAct task 工具结果携带，UI 用来在 think 与 task 视图间切换。 */
    taskId?: string;
    /** 记录种类，缺省 {@link MessageKind.Normal}；用于落库非 LLM 上下文消息（如 Command/Exception） */
    kind?: MessageKind;
}

// ─── Storage row wrapper ─────────────────────────────────────────────────────

/**
 * 持久化记录的种类。
 * - Normal    : 进入 LLM 上下文的正常历史
 * - Archive   : 已压缩归档（被摘要替代后不再进入上下文）
 * - Exception : 运行/工具异常，落库以便回溯，但不进入上下文
 * - Command   : `/command` 等指令型回调输出，落库以便展示，但不进入上下文
 *
 * 缺省值视作 Normal。
 */
export enum MessageKind {
    Normal    = 'normal',
    Archive   = 'archive',
    Exception = 'exception',
    Command   = 'command',
}

export interface StoredMessage {
    id: number;
    message: ChatMessage;
    createdAt: number;
    thinkId?: string;
    /** 该消息所属的子 agent task（若有）。供 UI 在 ThinkDrawer 切换 task 视图。 */
    taskId?: string;
    /** 记录种类。Saver 在落库/读取时都必须显式赋值。 */
    kind: MessageKind;
}

export interface NewStoredMessage {
    message: ChatMessage;
    thinkId?: string;
    taskId?: string;
    /** 记录种类。Saver 在落库/读取时都必须显式赋值。 */
    kind: MessageKind;
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
     * @param includeAll 是否包含非 Normal 的消息（Archive / Exception / Command）。默认 false。
     *   - false：仅返回 `kind === Normal` 或缺省的消息，用于 LLM 上下文/压缩判定
     *   - true：返回所有消息，用于管理端完整回溯
     *
     * 历史参数名 `includeCompacted` 的语义已扩展为「是否包含全部非 Normal 消息」，
     * 保留布尔签名以兼容旧调用方。
     */
    getAllMessages(includeAll?: boolean): Promise<StoredMessage[]>;

    /**
     * 获取当前线程的历史消息（仅 Normal 部分，可送入 LLM）
     */
    getMessages(): Promise<ChatMessage[]>;

    // --- 历史管理 ---

    /**
     * 向当前线程直接追加一条消息
     * @param message 要追加的消息
     * @param options 可选的附加选项
     */
    pushMessage(message: ChatMessage, options?: ChatMessageOptions): Promise<void>;

    /**
     * 对话压缩：将旧消息标记为 {@link MessageKind.Archive}，并把摘要作为新的 Normal 消息追加。
     */
    applyCompaction(compactedIds: number[], summary: NewStoredMessage): Promise<void>;

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

    // --- Metadata ---

    /**
     * 读取持久化的元数据（如 lastInputTokens）
     */
    getMetadata(key: string): Promise<string | undefined>;

    /**
     * 写入持久化的元数据
     */
    setMetadata(key: string, value: string): Promise<void>;

    // --- 会话搜索 ---

    /**
     * 全文搜索已归档（{@link MessageKind.Archive}）的历史消息。
     * Normal 消息仍在 LLM 上下文中，无需通过此接口检索。
     * 查询采用 CNF 形式：外层数组为 AND，内层数组为 OR。
     * 例如 [["error","fail"],["deploy"]] 表示 (error OR fail) AND deploy。
     * 任意内层为空数组或外层为空时返回空结果。
     */
    searchArchive?(query: string[][], limit?: number): Promise<StoredMessage[]>;

    // --- Task scope (subagent persistent sessions) ---

    /**
     * 读取指定 taskId 的子 Agent 会话历史。
     * @param includeAll 与 {@link getAllMessages} 同义，默认 false 仅返回 Normal。
     * 不存在则返回空数组。
     */
    getTaskMessages(taskId: string, includeAll?: boolean): Promise<StoredMessage[]>;

    /**
     * 向指定 taskId 追加一条子 Agent 消息。
     */
    pushTaskMessage(taskId: string, message: ChatMessage, options?: ChatMessageOptions): Promise<void>;

    /**
     * 对子 Agent 会话执行压缩：将旧消息标记为 {@link MessageKind.Archive} 并追加摘要。
     */
    applyTaskCompaction(taskId: string, compactedIds: number[], summary: NewStoredMessage): Promise<void>;

    /**
     * 清空指定 taskId 的子 Agent 会话历史与元数据。
     */
    clearTask(taskId: string): Promise<void>;

    /**
     * 读取 task 作用域的元数据（如压缩判定用的 lastInputTokens）。
     */
    getTaskMetadata(taskId: string, key: string): Promise<string | undefined>;

    /**
     * 写入 task 作用域的元数据。
     */
    setTaskMetadata(taskId: string, key: string, value: string): Promise<void>;


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

