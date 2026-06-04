import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { ContentPartType } from './types'
import type { DisplayPart, DisplayContent } from './types'

const pad2 = (n: number) => n.toString().padStart(2, '0')

const KNOWN_HTML_TAGS = new Set([
  'a', 'abbr', 'address', 'article', 'aside', 'b', 'bdi', 'bdo', 'blockquote', 'br',
  'caption', 'cite', 'code', 'col', 'colgroup', 'dd', 'del', 'details', 'dfn',
  'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'i', 'img', 'input', 'ins', 'kbd',
  'li', 'main', 'mark', 'nav', 'ol', 'p', 'picture', 'pre', 'q', 'rp', 'rt',
  'ruby', 's', 'samp', 'section', 'small', 'source', 'span', 'strong', 'sub',
  'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time',
  'tr', 'u', 'ul', 'var', 'wbr',
])

/**
 * Escape `<` of any tag whose name is not a known HTML element so XML-like
 * payloads (e.g. tool outputs containing `<channels>` or `<aaa />`) survive
 * marked + DOMPurify and render as literal text instead of being stripped.
 * Auto-link forms like `<https://x>` are left alone via the `[\s/>]` lookahead.
 */
function escapeUnknownHtmlTags(text: string): string {
  return text.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)(?=[\s/>])/g, (match, slash, tagName) => {
    if (KNOWN_HTML_TAGS.has(tagName.toLowerCase())) return match
    return `&lt;${slash}${tagName}`
  })
}

function dataUrl(mime: string | undefined, base64: string | undefined): string | null {
  if (!mime || !base64) return null
  return `data:${mime};base64,${base64}`
}

/** Convert a heterogeneous content blob into a uniform list of DisplayPart. */
export function getContentParts(content: DisplayContent | null | undefined): DisplayPart[] {
  if (!content) return []
  if (typeof content === 'string') {
    return [{ type: ContentPartType.Text, text: content }]
  }
  const parts: DisplayPart[] = []
  for (const c of content) {
    if (typeof c === 'string') {
      parts.push({ type: ContentPartType.Text, text: c })
      continue
    }
    if (!c || typeof c !== 'object') continue
    switch (c.type) {
      case 'text':
        if (c.text) parts.push({ type: ContentPartType.Text, text: c.text })
        break
      case 'image_url':
        if (c.image_url?.url) parts.push({ type: ContentPartType.Image, url: c.image_url.url })
        break
      case 'inlineData': {
        const url = dataUrl(c.inlineData?.mimeType, c.inlineData?.data)
        if (url) parts.push({ type: ContentPartType.Image, url })
        break
      }
      case 'image': {
        const url = c.dataUrl ?? dataUrl(c.mimeType, c.data)
        if (url) parts.push({ type: ContentPartType.Image, url })
        break
      }
      case 'audio': {
        const url = dataUrl(c.mimeType, c.data)
        if (url) parts.push({ type: ContentPartType.Audio, url })
        break
      }
      // PDF / generic binary: render the embedded image preview when possible.
      case 'document': {
        const url = dataUrl(c.mimeType, c.data)
        if (url) parts.push({ type: ContentPartType.Image, url })
        break
      }
    }
  }
  return parts
}

/** Concatenate all textual parts and render to sanitized HTML. */
export function renderMd(content: DisplayContent | null | undefined): string {
  if (!content) return ''
  const text = typeof content === 'string'
    ? content
    : content
      .map((c) => (typeof c === 'string' ? c : c?.type === 'text' ? (c.text ?? '') : ''))
      .filter(Boolean)
      .join('\n')
  const html = marked.parse(escapeUnknownHtmlTags(text)) as string
  return DOMPurify.sanitize(html)
}

/** Format a unix-seconds timestamp as `HH:mm` (today), `MM/DD HH:mm` (this year), or `YYYY/MM/DD HH:mm`. */
export function fmtTs(ts?: number): string {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  const now = new Date()
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  if (d.toDateString() === now.toDateString()) return time
  if (d.getFullYear() === now.getFullYear()) {
    return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${time}`
  }
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${time}`
}

/** Format a unix-seconds timestamp as a date separator label. */
export function fmtDateSep(ts: number | undefined, todayLabel: string, yesterdayLabel: string): string {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return todayLabel
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return yesterdayLabel
  if (d.getFullYear() === now.getFullYear()) {
    return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`
  }
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`
}

/** Toggle the `.expanded` state on a tool-call header and show/hide the sibling detail panel. */
export function toggleToolCall(el: HTMLElement): void {
  el.classList.toggle('expanded')
  const detail = el.nextElementSibling
  detail?.classList.toggle('show')
}
