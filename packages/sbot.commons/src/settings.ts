export const DEFAULT_PORT = 5500;

/** Web channel 的固定 channelId 和 type */
export const WEB_CHANNEL_ID = 'web';
export const WEB_CHANNEL_TYPE = 'web';

export enum SaverType {
  File   = "file",
  Sqlite = "sqlite",
  Memory = "memory",
}

export enum AgentMode {
  Single     = "single",
  ReAct      = "react",
  Generative = "generative",
  ACP        = "acp",
}

export enum ACPSessionMode {
  Persistent = "persistent",
  Transient  = "transient",
}

export enum ModelProvider {
  OpenAI         = "openai",
  OpenAIResponse = "openai-response",
  Anthropic      = "anthropic",
  Ollama         = "ollama",
  Gemini         = "gemini",
  GeminiImage    = "gemini-image",
}

export interface ThinkingConfig {
  type: "adaptive" | "enabled" | "disabled"
  budgetTokens?: number
}

export interface AnthropicConfig {
  thinking?: ThinkingConfig
  promptCaching?: boolean
}

export interface GeminiConfig {
  apiVersion?: string
}

export interface ModelConfig {
  name: string
  provider: ModelProvider
  baseURL: string
  apiKey: string
  model: string
  temperature?: number
  maxTokens?: number
  contextWindow?: number
  maxTools?: number
  anthropic?: AnthropicConfig
  gemini?: GeminiConfig
}

export enum EmbeddingProvider {
  OpenAI   = "openai",
  Ollama   = "ollama",
  Gemini   = "gemini",
  VoyageAI = "voyageai",
  Cohere   = "cohere",
}

export interface EmbeddingConfig {
  name: string
  provider: EmbeddingProvider
  baseURL?: string
  apiKey: string
  model: string
}

export enum InsightScope {
  Disabled = "disabled",
  Agent    = "agent",
  Session  = "session",
}

export interface InsightConfig {
  scope: InsightScope
  extractor: string
  extractorPromptFile?: string
}

export enum TodoScope {
  Disabled = "disabled",
  Session  = "session",
}

export interface TodoConfig {
  scope: TodoScope
  extractor: string
  extractorPromptFile?: string
}

export interface MemoryConfig {
  /** 显示名称 */
  name: string
  /** 记忆使用的 embedding UUID（对应 embeddings 中的 key） */
  embedding: string
}

export interface WikiConfig {
  /** 显示名称 */
  name: string
  /** 可选的 embedding 配置 ID，启用语义搜索 */
  embedding?: string
}

export interface SaverConfig {
  /** 显示名称 */
  name: string
  /** 存储类型：file | sqlite | memory */
  type: SaverType
}

export interface SubAgentRef {
  /** Agent ID（对应 ~/.sbot/agents/<id> 目录名） */
  id: string
  desc: string
}

export interface AgentStoreSource {
  url: string
  version?: string
  installedAt: string
  updatedAt?: string
}

export interface McpBuiltin {
  name: string
  description?: string
}

export enum McpTransport {
  Http = 'http',
  Sse = 'sse',
  Stdio = 'stdio',
}

export interface McpEntry {
  type: McpTransport
  url?: string
  headers?: Record<string, string>
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  toolTimeout?: number
  enablePromptTools?: boolean
  enableResourceTools?: boolean
  [key: string]: unknown
}

export interface AgentConfig {
  name?: string
  type: AgentMode | string
  tags?: string[]
  // 所有模式（ACP 除外）
  model?: string
  systemPrompt?: string
  // 所有模式
  autoApproveTools?: string[]
  autoApproveAllTools?: boolean
  // single / react（ToolAgent）
  mcp?: string[] | '*'
  mcpExclude?: string[]
  mcpParams?: Record<string, Record<string, string>>
  skills?: string[] | '*'
  insight?: InsightConfig
  todo?: TodoConfig
  compactModel?: string
  modelCallTimeout?: number
  // react
  agents?: SubAgentRef[]
  // generative
  maxHistoryRounds?: number
  // acp
  command?: string
  args?: string[]
  env?: Record<string, string>
  sessionMode?: ACPSessionMode
  /** ACP process initialization timeout in seconds. <=0 or unset = no timeout. */
  initTimeout?: number
  // store
  storeSource?: AgentStoreSource
}

/** 单个版本的配置快照 */
export interface AgentPackageVersion {
  version: string
  agent: Omit<AgentConfig, 'storeSource' | 'mcp' | 'mcpExclude' | 'skills' | 'autoApproveTools' | 'autoApproveAllTools' | 'model'>
}

/** 智能体包 = 元信息 + 版本列表（index 0 = 最新版） */
export interface AgentPackage {
  id: string
  name: string
  description?: string
  author?: string
  tags?: string[]
  versions: AgentPackageVersion[]
}

export interface AgentSourceEntry {
  url: string
  name?: string
}

export interface SessionConfig {
  /** 显示名称 */
  name: string
  /** 使用的 Agent ID（对应 ~/.sbot/agents/<id> 目录名） */
  agent: string
  /** 使用的 Saver 配置 UUID（对应 savers 中的 key） */
  saver: string
  /** 使用的记忆配置 UUID 列表（对应 memories 中的 key） */
  memories: string[]
  /** 使用的 Wiki 配置 UUID 列表（对应 wikis 中的 key） */
  wikis?: string[]
  /** 工作目录路径（有值时为目录模式，Agent 文件操作限定在此目录） */
  workPath?: string
  /** 自动批准所有工具调用 */
  autoApproveAllTools?: boolean
}

/** Approval 超时返回值 */
export enum ApprovalTimeoutValue {
  Allow = 'allow',
  Deny  = 'deny',
}

export interface ChannelConfig {
  // ── 频道基础配置（不可被会话覆盖） ──
  /** 显示名称 */
  name: string
  /** 频道类型（匹配插件 type，如 "lark", "slack", "telegram"） */
  type: string
  /** 插件特有配置（appId, botToken 等） */
  config: Record<string, any>

  // ── 频道级默认值（ChannelSessionRow 中同名字段可逐会话覆盖，会话值为 null 时回退到此处） ──
  /** Agent ID（对应 ~/.sbot/agents/<id> 目录名） */
  agent: string
  /** Saver 配置 UUID（对应 savers 中的 key） */
  saver: string
  /** 记忆配置 UUID 列表（对应 memories 中的 key） */
  memories: string[]
  /** Wiki 配置 UUID 列表（对应 wikis 中的 key） */
  wikis?: string[]
  /** 工作目录路径 */
  workPath?: string
  /** 是否输出中间消息和流式输出 */
  streamVerbose?: boolean
  /** 自动批准所有工具调用 */
  autoApproveAllTools?: boolean
  /** Approval 等待超时（秒），<=0 或不设置则不超时 */
  approvalTimeout?: number
  /** Approval 超时后的默认结果，默认 'deny' */
  approvalTimeoutValue?: ApprovalTimeoutValue
  /** Ask 等待超时（秒），<=0 或不设置则不超时 */
  askTimeout?: number
  /** Ask 超时抛回 LLM 的错误信息，默认 'User did not answer within the allotted time' */
  askTimeoutMessage?: string
  /** 意图识别模型 UUID */
  intentModel?: string
  /** 自定义意图过滤 prompt */
  intentPrompt?: string
  /** 意图识别置信度阈值 0-1 */
  intentThreshold?: number
  /** 消息合并窗口（毫秒），同一会话在此时间内的连续消息会合并后再处理。0 或不设置表示不合并 */
  mergeWindow?: number
  /** 日常对话工具白名单。不设置：全部可用；空数组：屏蔽全部；非空：仅白名单内可用 */
  tools?: string[]
  /** 心跳工具白名单。不设置：全部可用；空数组：屏蔽全部；非空：仅白名单内可用 */
  heartbeatTools?: string[]
}

export interface Settings {
  httpPort?: number
  httpUrl?: string
  autoApproveTools?: string[]
  autoApproveAllTools?: boolean
  /** 启动后立即执行的命令行列表，依次同步执行 */
  startupCommands?: string[]
  /** 下次检查更新的时间戳（ms），0 或 undefined 表示立即检查 */
  checkUpdateTime?: number
  /** 图片最大尺寸（px），max(width,height) 超过此值时按比例缩小；不设置则不压缩 */
  maxImageSize?: number
  /** Channel 插件列表（npm 包名或本地路径） */
  plugins?: string[]
  /** 由 ~/.sbot/agents/ 目录管理，API 响应中由服务端动态注入；不写入 settings.json */
  agents?: Record<string, AgentConfig>
  models?: Record<string, ModelConfig>
  embeddings?: Record<string, EmbeddingConfig>
  memories?: Record<string, MemoryConfig>
  wikis?: Record<string, WikiConfig>
  savers?: Record<string, SaverConfig>
  channels?: Record<string, ChannelConfig>

  agentSources?: AgentSourceEntry[]
}
