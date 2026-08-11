import { MessageRole } from './types'
import type { ToolCall, StoredMessage } from './types'

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s
}

function stringify(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v)
}

/** 一行摘要里最多放几个参数。 */
const INLINE_ARGS_MAX = 2

/**
 * 只有标量适合塞进一行摘要：布尔几乎不含区分度（`useRegex=true` 说明不了任何事），
 * 对象和数组要展开才有意义。
 */
function isSummarizable(v: unknown): boolean {
  return (typeof v === 'string' && v !== '') || typeof v === 'number'
}

/**
 * Render the args of a tool call as a compact inline summary.
 *
 * 参数多的工具同样需要摘要 —— 一屏 7 个 `grep` 如果都不显示参数就完全无法区分，
 * 所以这里从中挑出有区分度的几个，而不是放弃。
 */
export function inlineArgs(tc: ToolCall): string {
  const args = tc.args
  if (!args || typeof args !== 'object' || Array.isArray(args)) return ''
  const obj = args as Record<string, unknown>
  const keys = Object.keys(obj)
  if (keys.length === 0) return ''
  // 保持参数原有顺序：工具定义通常把主要参数排在前面（grep 的 path/pattern 就在
  // maxMatches/timeoutSec 之前），比按类型重排更可预测。
  const picked = keys.filter((k) => isSummarizable(obj[k]))
  // 全是布尔/对象时回退到原始顺序：低信息量的摘要仍然好过没有摘要。
  const use = (picked.length ? picked : keys).slice(0, INLINE_ARGS_MAX)
  return use.map((k) => `${k}=${truncate(stringify(obj[k]), 40)}`).join('  ')
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
