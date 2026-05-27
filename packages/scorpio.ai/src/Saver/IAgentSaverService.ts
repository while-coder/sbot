// ─── Neutral message types (no LangChain dependency) ────────────────────────

export interface TokenUsage {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
}

export enum MessageRole {
    Human  = 'human',
    AI     = 'ai',
    Tool   = 'tool',
    System = 'system',
}

export interface ChatToolCall {
    id?: string;
    name: string;
    args: Record<string, any>;
    type?: string;
}

// ─── Content parts (discriminated union by `type`) ───────────────────────────

/**
 * 多模态消息内容 part 的判别符
 *
 * 该集合由本仓库内部 + 直连 LLM/Channel 时实际出现的取值聚合而来。
 * 透传给 SDK 时还可能出现 provider 专属取值，由 `ContentPart` 末尾的兜底分支兼容。
 */
export const ContentPartType = {
    Text:     'text',
    /** Anthropic / ACP 风格：data + mimeType */
    Image:    'image',
    /** OpenAI 兼容风格：image_url.url */
    ImageUrl: 'image_url',
    Audio:    'audio',
} as const;
export type ContentPartType = typeof ContentPartType[keyof typeof ContentPartType];

/** 文本 part，可选携带 Anthropic 的 cache 标记 */
interface TextPart {
    type: 'text';
    text: string;
    cache_control?: any;
}

/** Anthropic / ACP 风格的图像 part（base64 + mimeType） */
interface ImagePart {
    type: 'image';
    data: string;
    mimeType?: string;
}

/** OpenAI 兼容风格的图像 part（dataUrl 或外链） */
interface ImageUrlPart {
    type: 'image_url';
    image_url: { url: string };
    mimeType?: string;
}

/** 音频 part（base64 + mimeType） */
interface AudioPart {
    type: 'audio';
    data: string;
    mimeType?: string;
}

/**
 * 多模态消息 part 的判别联合类型。
 *
 * - 已知形状：`TextPart` / `ImagePart` / `ImageUrlPart` / `AudioPart`
 * - 末尾的开放分支用于透传 provider 专属 part（如 `tool_use` / `tool_result` / `thinking` 等），
 *   避免类型阻塞迭代；仍保留 `type: string` 以维持运行时一致性。
 */
export type ContentPart =
    | TextPart
    | ImagePart
    | ImageUrlPart
    | AudioPart
    | { type: string; [key: string]: any };

/**
 * 中性化的消息结构，不依赖任何 LLM 框架
 *
 * - human   : 用户输入
 * - ai      : 模型输出（可含 tool_calls）
 * - tool    : 工具执行结果（含 tool_call_id）
 */
export interface ChatMessage {
    role: MessageRole;
    content: string | ContentPart[];
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
    /** 模型返回的 token 用量（仅 AI 消息，不持久化） */
    usage?: TokenUsage;
}

/** Reusable alias for ChatMessage.content — text or multimodal content parts. */
export type MessageContent = ChatMessage['content'];

// ─── Push options ────────────────────────────────────────────────────────────

export interface ChatMessageOptions {
    /** 关联的 think 记录 ID（由 ReAct 子 Agent 执行时携带） */
    thinkId?: string;
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
    /** 记录种类。Saver 在落库/读取时都必须显式赋值。 */
    kind: MessageKind;
}

export interface NewStoredMessage {
    message: ChatMessage;
    thinkId?: string;
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

