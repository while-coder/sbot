import { MessageRole } from './types'
import type { ToolCall, StoredMessage } from './types'

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

export function resultPreview(messages: StoredMessage[], toolCallId: string): string {
  const msg = messages.find(
    (m) => m.message.role === MessageRole.Tool && m.message.tool_call_id === toolCallId,
  )
  if (!msg) return ''
  const raw = msg.message.content
  if (!raw) return ''

  if (typeof raw === 'string') {
    const oneLine = raw.replace(/\s+/g, ' ').trim()
    return oneLine.length > 80 ? oneLine.slice(0, 80) + '…' : oneLine
  }

  if (!Array.isArray(raw)) return ''

  const textParts: string[] = []
  const mediaTags: string[] = []
  for (const b of raw) {
    if (typeof b === 'string') textParts.push(b)
    else if (b?.type === 'text' && b.text) textParts.push(b.text)
    else if (b?.type === 'image' || b?.type === 'image_url' || b?.type === 'inlineData') mediaTags.push('[image]')
    else if (b?.type === 'audio') mediaTags.push('[audio]')
    else if (b?.type === 'document') mediaTags.push('[document]')
  }
  const text = textParts.join('').replace(/\s+/g, ' ').trim()
  const media = mediaTags.join(' ')
  const combined = [media, text].filter(Boolean).join(' ')
  if (!combined) return ''
  return combined.length > 80 ? combined.slice(0, 80) + '…' : combined
}
