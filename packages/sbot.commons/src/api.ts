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
  source?: string
  dirName?: string
}

export interface McpItem {
  id: string
  name: string
  description?: string
  source?: string
  type?: string
  url?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  headers?: Record<string, string>
  toolTimeout?: number
}

export interface ToolCall {
  id: string
  name: string
  args: unknown
}

export enum MessageRole {
  Human = 'human',
  AI    = 'ai',
  Tool  = 'tool',
}

export interface ChatMessage {
  role: MessageRole | string
  content?: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

export interface StoredMessage {
  message: ChatMessage
  createdAt?: number
  thinkId?: string
}

export interface MemoryItem {
  id: string
  content: string
  importance?: number
  timestamp?: number
  accessCount?: number
  lastAccessed?: number
}