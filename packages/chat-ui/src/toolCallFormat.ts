import { MessageRole } from './types'
import type { ToolCall, StoredMessage } from './types'

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s
}

function stringify(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v)
}

/** Render the args of a tool call as a compact inline summary (only when ≤2 args). */
export function inlineArgs(tc: ToolCall): string {
  const args = tc.args
  if (!args || typeof args !== 'object' || Array.isArray(args)) return ''
  const obj = args as Record<string, unknown>
  const keys = Object.keys(obj)
  if (keys.length === 0 || keys.length > 2) return ''
  return keys.map((k) => `${k}=${truncate(stringify(obj[k]), 40)}`).join('  ')
}

/** Produce a short single-line preview for a tool-result message. */
export function resultPreviewFromMessage(msg: StoredMessage | undefined): string {
  const raw = msg?.message.content
  if (!raw) return ''

  if (typeof raw === 'string') {
    return truncate(raw.replace(/\s+/g, ' ').trim(), 80)
  }
  if (!Array.isArray(raw)) return ''

  const textParts: string[] = []
  const mediaTags: string[] = []
  for (const b of raw) {
    if (typeof b === 'string') {
      textParts.push(b)
      continue
    }
    switch (b?.type) {
      case 'text': if (b.text) textParts.push(b.text); break
      case 'image':
      case 'image_url':
      case 'inlineData': mediaTags.push('[image]'); break
      case 'audio':      mediaTags.push('[audio]'); break
      case 'document':   mediaTags.push('[document]'); break
    }
  }
  const text  = textParts.join('').replace(/\s+/g, ' ').trim()
  const media = mediaTags.join(' ')
  const combined = [media, text].filter(Boolean).join(' ')
  return combined ? truncate(combined, 80) : ''
}

/** Find the tool-result message for `toolCallId` and produce a short single-line preview. */
export function resultPreview(messages: StoredMessage[], toolCallId: string): string {
  const msg = messages.find(
    (m) => m.message.role === MessageRole.Tool && m.message.tool_call_id === toolCallId,
  )
  return resultPreviewFromMessage(msg)
}
