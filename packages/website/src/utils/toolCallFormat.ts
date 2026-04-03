import type { ToolCall, StoredMessage } from '@/types'
import { MessageRole } from '@/types'

/** Format 1-2 args inline as "key=value" pairs; returns empty string for 3+. */
export function inlineArgs(tc: ToolCall): string {
  const args = tc.args
  if (!args || typeof args !== 'object' || Array.isArray(args)) return ''
  const keys = Object.keys(args as Record<string, unknown>)
  if (keys.length === 0 || keys.length > 2) return ''
  return keys.map((k) => {
    const obj = args as Record<string, unknown>
    let s = typeof obj[k] === 'string' ? obj[k] as string : JSON.stringify(obj[k])
    if (s.length > 40) s = s.slice(0, 40) + '…'
    return `${k}=${s}`
  }).join('  ')
}

/** Find the tool result for a given tool_call_id and return a truncated preview. */
export function resultPreview(messages: StoredMessage[], toolCallId: string): string {
  const msg = messages.find(
    (m) => m.message.role === MessageRole.Tool && m.message.tool_call_id === toolCallId,
  )
  if (!msg) return ''
  const content = typeof msg.message.content === 'string'
    ? msg.message.content
    : Array.isArray(msg.message.content)
      ? msg.message.content.map((b: any) => (typeof b === 'string' ? b : b?.text ?? '')).join('')
      : ''
  if (!content) return ''
  const oneLine = content.replace(/\s+/g, ' ').trim()
  return oneLine.length > 80 ? oneLine.slice(0, 80) + '…' : oneLine
}
