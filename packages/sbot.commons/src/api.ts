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
}

export interface ToolCall {
  id: string
  name: string
  args: unknown
}

export interface ChatMessage {
  role: string
  content?: string
  timestamp?: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

export interface MemoryItem {
  id: string
  content: string
  importance?: number
  timestamp?: number
  accessCount?: number
  lastAccessed?: number
}

export interface LocalConfig {
  agentId: string
  saverId: string
  memoryId: string | null
}
