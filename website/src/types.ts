export interface Model {
  provider?: string
  baseURL?: string
  apiKey?: string
  model?: string
  temperature?: number
  [key: string]: unknown
}

export interface Embedding {
  provider?: string
  baseURL?: string
  apiKey?: string
  model?: string
  [key: string]: unknown
}

export interface MemoryConfig {
  mode?: string
  maxAgeDays?: number
  embedding?: string
  evaluator?: string
  extractor?: string
  compressor?: string
  [key: string]: unknown
}

export interface SaverConfig {
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

export interface Settings {
  agent?: string
  httpUrl?: string
  agents?: Record<string, Agent>
  models?: Record<string, Model>
  embeddings?: Record<string, Embedding>
  memories?: Record<string, MemoryConfig>
  savers?: Record<string, SaverConfig>
  lark?: { appId?: string; appSecret?: string }
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
  timestamp?: string
  category?: string
}
