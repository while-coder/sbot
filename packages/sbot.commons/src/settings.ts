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
  extractor?: string;
  extractorPrompt?: string;
}

export enum MemoryMode {
  ReadOnly    = "read_only",
  HumanOnly   = "human_only",
  HumanAndAI  = "human_and_ai",
}

export interface MemoryConfig {
  /** 显示名称 */
  name: string
  /** 记忆模式 */
  mode: MemoryMode
  /** 记忆最大保留天数 */
  maxAgeDays?: number
  /** 记忆使用的 embedding UUID（对应 embeddings 中的 key） */
  embedding: string
  /** 知识提取器使用的模型 UUID（对应 models 中的 key） */
  extractor: string
  /** 记忆压缩器使用的模型 UUID（对应 models 中的 key） */
  compressor?: string
  /** 提取器 system prompt 文件路径（相对于 ~/.sbot/prompts/，默认 memory/extractor.txt） */
  extractorPrompt?: string
  /** 压缩器 prompt 文件路径（相对于 ~/.sbot/prompts/，默认 memory/compressor.txt） */
  compressorPrompt?: string
  /** 是否共享记忆（true = 所有 thread 共用同一份记忆；false = 每个 thread 独立，默认） */
  share: boolean
}

export interface WikiConfig {
  /** 显示名称 */
  name: string
  /** 知识提取器使用的模型 UUID（对应 models 中的 key） */
  extractor: string
  /** 对话后自动提取知识（默认 true） */
  autoExtract?: boolean
  /** 提取器 system prompt 文件路径（相对于 ~/.sbot/prompts/，默认 wiki/extractor.txt） */
  extractorPrompt?: string
  /** 是否共享（true = 所有 thread 共用同一份 wiki；false = 每个 thread 独立，默认） */
  share: boolean
}

export interface SaverConfig {
  /** 显示名称 */
  name: string
  /** 存储类型：file | sqlite | memory */
  type: SaverType
  /** 是否共享存储（true = 所有 session 共用同一份存储；false = 每个 session 独立，默认） */
  share: boolean
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

export interface McpEntry {
  type: string
  url?: string
  headers?: Record<string, string>
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  toolTimeout?: number
  [key: string]: unknown
}

export interface AgentConfig {
  name?: string
  type: AgentMode | string
  // 所有模式（ACP 除外）
  model?: string
  systemPrompt?: string
  // 所有模式
  autoApproveTools?: string[]
  autoApproveAllTools?: boolean
  // single / react（ToolAgent）
  mcp?: string[] | '*'
  skills?: string[] | '*'
  insight?: InsightConfig
  compactModel?: string
  compactPrompt?: string
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
  // store
  storeSource?: AgentStoreSource
}

/** 单个版本的配置快照 */
export interface AgentPackageVersion {
  version: string
  agent: Omit<AgentConfig, 'storeSource' | 'mcp' | 'skills' | 'autoApproveTools' | 'autoApproveAllTools' | 'model'>
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
  /** 意图识别模型 UUID */
  intentModel?: string
  /** 自定义意图过滤 prompt */
  intentPrompt?: string
  /** 意图识别置信度阈值 0-1 */
  intentThreshold?: number
  /** 消息合并窗口（毫秒），同一会话在此时间内的连续消息会合并后再处理。0 或不设置表示不合并 */
  mergeWindow?: number
  /** 日常对话工具白名单，不设置则全部可用 */
  tools?: string[]
  /** 心跳可用工具白名单 */
  heartbeatTools?: string[]
}

export interface Settings {
  httpPort?: number
  httpUrl?: string
  autoApproveTools?: string[]
  autoApproveAllTools?: boolean
  /** 启动后立即执行的命令行列表，依次同步执行 */
  startupCommands?: string[]
  /** Channel 插件列表（npm 包名或本地路径） */
  plugins?: string[]
  /** @deprecated 迁移后由 ~/.sbot/agents/ 目录管理，API 响应中动态注入 */
  agents?: Record<string, AgentConfig>
  models?: Record<string, ModelConfig>
  embeddings?: Record<string, EmbeddingConfig>
  memories?: Record<string, MemoryConfig>
  wikis?: Record<string, WikiConfig>
  savers?: Record<string, SaverConfig>
  channels?: Record<string, ChannelConfig>

  agentSources?: AgentSourceEntry[]
}
