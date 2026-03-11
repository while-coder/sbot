export interface Model {
  name?: string
  provider?: string
  baseURL?: string
  apiKey?: string
  model?: string
  temperature?: number
  maxTokens?: number
  [key: string]: unknown
}

export interface Embedding {
  name?: string
  provider?: string
  baseURL?: string
  apiKey?: string
  model?: string
  [key: string]: unknown
}

export interface MemoryConfig {
  name?: string
  mode?: string
  maxAgeDays?: number
  embedding?: string
  evaluator?: string
  extractor?: string
  compressor?: string
  [key: string]: unknown
}

export interface SaverConfig {
  name?: string
  type?: string
  [key: string]: unknown
}

export interface SubAgentRef {
  name: string
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
  type: string
  // single
  model?: string
  systemPrompt?: string
  mcp?: string[]
  skills?: string[]
  // react
  maxIterations?: number
  think?: string
  reflect?: string
  summarizer?: string
  // supervisor
  maxRounds?: number
  supervisor?: string
  finalize?: string
  // shared for react/supervisor
  agents?: SubAgentRef[]
  // memory & saver (all types)
  memory?: string
  saver?: string
  [key: string]: unknown
}

export interface SessionConfig {
  name?: string
  agent: string
  saver: string
  memory?: string
  [key: string]: unknown
}

export interface ChannelConfig {
  name?: string
  type: string
  appId?: string
  appSecret?: string
  agent: string
  saver: string
  memory?: string
  [key: string]: unknown
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
  [key: string]: unknown
}

export interface McpTool {
  name: string
  description?: string
  inputSchema?: {
    properties?: Record<string, unknown>
    required?: string[]
    [key: string]: unknown
  }
}

export interface SkillItem {
  name: string
  description?: string
  content?: string
  isBuiltin?: boolean
}

export interface ChatMessage {
  role: string
  content?: string
  timestamp?: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

export interface ToolCall {
  id: string
  name: string
  args: unknown
}

export interface MemoryItem {
  id: string
  content: string
  importance?: number
  timestamp?: number
  accessCount?: number
  lastAccessed?: number
}
