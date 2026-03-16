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
  name?: string
  mode?: string
  autoCleanup?: boolean
  maxAgeDays?: number
  embedding?: string
  evaluator?: string
  extractor?: string
  compressor?: string
}

export interface SaverConfig {
  name?: string
  type?: SaverType | string
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
  name?: string
  agent: string
  saver: string
  memory?: string
}

export interface ChannelConfig {
  name?: string
  type: ChannelType | string
  appId?: string
  appSecret?: string
  agent: string
  saver: string
  memory?: string
}

export interface DirectoryConfig {}

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
