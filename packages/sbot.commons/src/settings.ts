export const DEFAULT_PORT = 5500;

export enum SaverType {
  File   = "file",
  Sqlite = "sqlite",
  Memory = "memory",
}

export enum AgentMode {
  Single     = "single",
  ReAct      = "react",
  Generative = "generative",
}

export enum ModelProvider {
  OpenAI         = "openai",
  OpenAIResponse = "openai-response",
  Anthropic      = "anthropic",
  Ollama         = "ollama",
  Gemini         = "gemini",
  GeminiImage    = "gemini-image",
}

export interface ModelConfig {
  name: string
  provider: ModelProvider
  baseURL: string
  apiKey: string
  model: string
  apiVersion?: string
  temperature?: number
  maxTokens?: number
  contextWindow?: number
}

export enum EmbeddingProvider {
  OpenAI = "openai",
  Ollama = "ollama",
}

export interface EmbeddingConfig {
  name: string
  provider: EmbeddingProvider
  baseURL: string
  apiKey: string
  model: string
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
  model?: string
  systemPrompt?: string
  mcp?: string[] | '*'
  skills?: string[] | '*'
  autoApproveTools?: string[]
  autoApproveAllTools?: boolean
  // react
  agents?: SubAgentRef[]
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
  /** 显示名称 */
  name: string
  /** 频道类型（匹配插件 type，如 "lark", "slack", "telegram"） */
  type: string
  /** 该频道使用的 Agent ID（对应 ~/.sbot/agents/<id> 目录名） */
  agent: string
  /** 使用的 Saver 配置 UUID（对应 savers 中的 key） */
  saver: string
  /** 使用的记忆配置 UUID 列表（对应 memories 中的 key） */
  memories: string[]
  /** 使用的 Wiki 配置 UUID 列表（对应 wikis 中的 key） */
  wikis?: string[]
  /** 插件特有配置（appId, botToken 等） */
  config: Record<string, any>
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
