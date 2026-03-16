export interface ChatEvent {
  type: 'stream' | 'message' | 'tool_call' | 'error' | 'done'
  content?: string
  role?: string
  tool_calls?: unknown[]
  name?: string
  args?: unknown
  message?: string
}
