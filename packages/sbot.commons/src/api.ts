export interface McpTool {
  name: string
  description?: string
  inputSchema?: {
    properties?: Record<string, unknown>
    required?: string[]
    [key: string]: unknown
  }
}

export interface McpPromptArg {
  name: string
  description?: string
  required?: boolean
}

export interface McpPrompt {
  name: string
  description?: string
  arguments?: McpPromptArg[]
}

export interface McpResource {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

export interface McpResourceTemplate {
  uriTemplate: string
  name: string
  description?: string
  mimeType?: string
}

export interface SkillItem {
  id?: string
  path?: string
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
  /** 工具消息的执行状态：success / error / running（running 为 think 进行中的占位，完成后被真结果按 tool_call_id 覆盖） */
  status?: string
}

export interface StoredMessage {
  message: ChatMessage
  createdAt?: number
  thinkId?: string
}

export interface NoteItem {
  id: string
  content: string
  createdAt: number
  accessCount: number
  lastAccessed: number
}
