import { marked } from 'marked'

export enum ContentPartType {
  Text = 'text',
  Image = 'image',
  Audio = 'audio',
}

export interface DisplayPart {
  type: ContentPartType
  text?: string
  url?: string
}

/** Convert LangChain MessageContent (string or array) into ordered display parts */
export function getContentParts(content: string | any[] | undefined | null): DisplayPart[] {
  if (!content) return []
  if (typeof content === 'string') return [{ type: ContentPartType.Text, text: content }]
  const parts: DisplayPart[] = []
  for (const c of content) {
    if (typeof c === 'string') {
      parts.push({ type: ContentPartType.Text, text: c })
    } else if (c?.type === 'text' && c.text) {
      parts.push({ type: ContentPartType.Text, text: c.text })
    } else if (c?.type === 'image_url' && c.image_url?.url) {
      parts.push({ type: ContentPartType.Image, url: c.image_url.url })
    } else if (c?.type === 'inlineData' && c.inlineData?.data) {
      parts.push({ type: ContentPartType.Image, url: `data:${c.inlineData.mimeType};base64,${c.inlineData.data}` })
    } else if (c?.type === 'image' && c.data && c.mimeType) {
      parts.push({ type: ContentPartType.Image, url: `data:${c.mimeType};base64,${c.data}` })
    } else if (c?.type === 'audio' && c.data && c.mimeType) {
      parts.push({ type: ContentPartType.Audio, url: `data:${c.mimeType};base64,${c.data}` })
    } else if (c?.type === 'document' && c.data && c.mimeType) {
      parts.push({ type: ContentPartType.Image, url: `data:${c.mimeType};base64,${c.data}` })
    }
  }
  return parts
}

/** Render markdown content to HTML (handles both string and multipart array) */
export function renderMd(content: string | any[] | undefined | null): string {
  if (!content) return ''
  if (Array.isArray(content)) {
    return marked.parse(
      content
        .filter((c: any) => typeof c === 'string' || c?.type === 'text')
        .map((c: any) => (typeof c === 'string' ? c : c.text ?? ''))
        .join('\n')
    ) as string
  }
  return marked.parse(content) as string
}

/** Format unix timestamp for display */
export function fmtTs(ts?: number): string {
  if (!ts) return ''
  try {
    const d = new Date(ts * 1000)
    const now = new Date()
    const pad = (n: number) => n.toString().padStart(2, '0')
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
    if (d.toDateString() === now.toDateString()) return time
    if (d.getFullYear() === now.getFullYear()) return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${time}`
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${time}`
  } catch { return '' }
}

/** Toggle tool call detail expansion */
export function toggleToolCall(el: HTMLElement): void {
  el.classList.toggle('expanded')
  const detail = el.nextElementSibling as HTMLElement
  if (detail) detail.classList.toggle('show')
}
