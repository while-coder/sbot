export const DEFAULT_PORT = 5500;

export enum SaverType {
  File   = "file",
  Sqlite = "sqlite",
}

export enum AgentMode {
  Single = "single",
  ReAct  = "react",
}

export enum ChannelType {
  Lark = "lark",
  Slack = "slack",
}

export interface Model {
  name?: string
  provider?: string
  baseURL?: string
  apiKey?: string
  model?: string
  temperature?: number
  maxTokens?: number
}

export interface Embedding {
  name?: string
  provider?: string
  baseURL?: string
  apiKey?: string
  model?: string
}

export interface MemoryConfig {
  /** 显示名称（可选，便于识别） */
  name?: string
  /** 记忆模式 */
  mode?: string
  /** 是否自动清理过期记忆 */
  autoCleanup?: boolean
  /** 记忆最大保留天数 */
  maxAgeDays?: number
  /** 记忆使用的 embedding UUID（对应 embeddings 中的 key） */
  embedding?: string
  /** 重要性评估器使用的模型 UUID（对应 models 中的 key） */
  evaluator?: string
  /** 知识提取器使用的模型 UUID（对应 models 中的 key） */
  extractor?: string
  /** 记忆压缩器使用的模型 UUID（对应 models 中的 key） */
  compressor?: string
}

export interface SaverConfig {
  /** 显示名称（可选，便于识别） */
  name?: string
  /** 存储类型：file | sqlite */
  type?: SaverType
}

export interface SubAgentRef {
  id: string
  desc: string
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

export interface Agent {
  name?: string
  type: AgentMode | string
  // single
  model?: string
  systemPrompt?: string
  mcp?: string[]
  skills?: string[]
  // react
  think?: string
  agents?: SubAgentRef[]
  // memory & saver (all types)
  memory?: string
  saver?: string
}

export interface SessionConfig {
  /** 显示名称（可选，便于识别） */
  name?: string
  /** 使用的 Agent UUID（对应 agents 中的 key） */
  agent: string
  /** 使用的 Saver 配置 UUID（对应 savers 中的 key） */
  saver: string
  /** 使用的记忆配置 UUID（对应 memories 中的 key） */
  memory?: string
}

export interface ChannelConfig {
  /** 显示名称（可选，便于识别） */
  name?: string
  /** 频道类型 */
  type: ChannelType
  /** Lark App ID */
  appId?: string
  /** Lark App Secret */
  appSecret?: string
  /** Slack Bot Token (xoxb-...) */
  botToken?: string
  /** Slack App-Level Token for Socket Mode (xapp-...) */
  appToken?: string
  /** 该频道使用的 Agent UUID（对应 agents 中的 key） */
  agent: string
  /** 使用的 Saver 配置 UUID（对应 savers 中的 key） */
  saver: string
  /** 使用的记忆配置 UUID（对应 memories 中的 key） */
  memory?: string
}

// 配置内容（agent/saver/memory）保存在对应目录的 .sbot/settings.json，
// 全局 settings.directories 只做路径注册，value 保留为空对象
export interface DirectoryConfig {}

/** 目录本地配置（存储于 <dir>/.sbot/settings.json） */
export interface LocalDirConfig {
  /** 使用的 Agent UUID（对应 agents 中的 key） */
  agent: string
  /** 使用的 Saver 配置 UUID（对应 savers 中的 key） */
  saver: string
  /** 使用的记忆配置 UUID（对应 memories 中的 key） */
  memory?: string
}

export interface Settings {
  httpPort?: number
  httpUrl?: string
  agents?: Record<string, Agent>
  models?: Record<string, Model>
  embeddings?: Record<string, Embedding>
  memories?: Record<string, MemoryConfig>
  savers?: Record<string, SaverConfig>
  sessions?: Record<string, SessionConfig>
  channels?: Record<string, ChannelConfig>
  directories?: Record<string, DirectoryConfig>
}

// ── threadId 工厂函数 ──────────────────────────────────────────────────────────
// 集中定义，供 sbot（后端）与 website（前端）共用，避免算法分散后不同步

/** 目录模式 threadId：将路径中的非法字符（冒号、斜杠、反斜杠）替换为下划线 */
export function dirThreadId(workPath: string): string {
  return `dir_${workPath.replace(/[:/\\]/g, '_')}`
}

/** 会话模式 threadId */
export function sessionThreadId(sessionId: string): string {
  return `session_${sessionId}`
}

/** Lark 频道模式 threadId */
export function larkThreadId(channelId: string, chatId: string): string {
  return `lark_${channelId}_${chatId}`
}

/** Slack 频道模式 threadId */
export function slackThreadId(channelId: string, slackChannel: string, threadTs: string): string {
  return `slack_${channelId}_${slackChannel}_${threadTs}`
}
