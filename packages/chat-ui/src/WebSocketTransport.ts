import type { IChatTransport } from './transport'
import {
  ChatEventType,
  type ChatEvent,
  type ContentPart,
  type Attachment,
  type SessionItem,
  type CreateSessionOpts,
  type StoredMessage,
  type UsageInfo,
  type AppSettings,
  type SessionStatus,
  type ToolApprovalPayload,
  type AskAnswerPayload,
  type DirListResult,
  type QuickDir,
  type FsTreeResult,
  type FsReadResult,
  type GitStatusResult,
  type GitDiffResult,
} from './types'

type EventHandler = (event: ChatEvent) => void

const SESSION_EVENT_TYPES = new Set<string>(Object.values(ChatEventType).filter(v => v !== ChatEventType.ConnectionStatus))

export class WebSocketTransport implements IChatTransport {
  private ws: WebSocket | null = null
  private handlers = new Set<EventHandler>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private _baseUrl: string

  constructor(baseUrl = '') {
    this._baseUrl = baseUrl
  }

  get baseUrl() { return this._baseUrl }
  set baseUrl(url: string) { this._baseUrl = url }

  // ── Connection ──

  connect(): void {
    if (this.ws?.readyState === WebSocket.CONNECTING || this.ws?.readyState === WebSocket.OPEN) return
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    const url = this._baseUrl ? new URL(this._baseUrl) : location
    const proto = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${proto}//${url.host}/ws/chat`)
    this.ws = ws
    ws.onopen = () => {
      this.emit({ type: ChatEventType.ConnectionStatus, online: true } as ChatEvent)
    }
    ws.onmessage = (e: MessageEvent) => {
      let msg: any
      try { msg = JSON.parse(e.data as string) } catch { return }
      if (msg && SESSION_EVENT_TYPES.has(msg.type)) {
        this.emit({ type: msg.type, sessionId: msg.sessionId, data: msg.data } as ChatEvent)
      }
    }
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null
      this.emit({ type: ChatEventType.ConnectionStatus, online: false } as ChatEvent)
      this.reconnectTimer = setTimeout(() => this.connect(), 3000)
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null }
  }

  onEvent(handler: EventHandler): void { this.handlers.add(handler) }
  offEvent(handler: EventHandler): void { this.handlers.delete(handler) }

  private emit(event: ChatEvent) { this.handlers.forEach(h => h(event)) }

  private wsSend(data: any): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      this.emit({ type: ChatEventType.Error, data: { message: 'WebSocket is not connected' } } as ChatEvent)
      return
    }
    this.ws.send(JSON.stringify(data))
  }

  private async api(path: string, method = 'GET', body?: unknown): Promise<any> {
    const url = this._baseUrl + path
    const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } }
    if (body !== undefined) opts.body = JSON.stringify(body)
    const res = await fetch(url, opts)
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }))
      throw new Error(err.message || err.error || res.statusText)
    }
    const text = await res.text()
    return text ? JSON.parse(text) : undefined
  }

  // ── Sessions ──

  async listSessions(): Promise<SessionItem[]> {
    const res = await this.api('/api/sessions')
    return res.data ?? res ?? []
  }

  async createSession(opts: CreateSessionOpts): Promise<{ id: string }> {
    const res = await this.api('/api/settings/sessions', 'POST', opts)
    return { id: res.id ?? res.data?.id }
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.api(`/api/sessions/${encodeURIComponent(sessionId)}/history`, 'DELETE').catch(() => {})
    await this.api(`/api/settings/sessions/${encodeURIComponent(sessionId)}`, 'DELETE')
  }

  async updateSession(sessionId: string, patch: Partial<SessionItem>): Promise<void> {
    await this.api(`/api/settings/sessions/${encodeURIComponent(sessionId)}`, 'PUT', patch)
  }

  // ── Messages ──

  sendMessage(sessionId: string, parts: ContentPart[], attachments?: Attachment[]): void {
    this.wsSend({
      type: 'query',
      sessionId,
      parts,
      attachments: attachments?.length ? attachments : undefined,
    })
  }

  async getHistory(sessionId: string): Promise<StoredMessage[]> {
    const res = await this.api(`/api/sessions/${encodeURIComponent(sessionId)}/history`)
    return res.data ?? res ?? []
  }

  async clearHistory(sessionId: string): Promise<void> {
    await this.api(`/api/sessions/${encodeURIComponent(sessionId)}/history`, 'DELETE')
  }

  // ── Usage ──

  async getUsage(sessionId: string): Promise<UsageInfo | null> {
    try {
      const res = await this.api(`/api/thread-usage?sessions=${encodeURIComponent(sessionId)}`)
      return res.data?.[sessionId] ?? null
    } catch { return null }
  }

  // ── Tool approval / Ask / Abort ──

  approveToolCall(sessionId: string, payload: ToolApprovalPayload): void {
    this.wsSend({ type: 'approval', sessionId, id: payload.approvalId, approval: payload.approval })
  }

  answerAsk(sessionId: string, payload: AskAnswerPayload): void {
    this.wsSend({ type: 'ask', sessionId, id: payload.askId, answers: payload.answers })
  }

  abort(sessionId: string): void {
    this.wsSend({ type: 'abort', sessionId })
  }

  // ── Settings ──

  async getSettings(): Promise<AppSettings> {
    const res = await this.api('/api/settings')
    return res.data ?? res ?? { agents: {}, savers: {}, memories: {}, wikis: {} }
  }

  async getSessionStatus(sessionId: string): Promise<SessionStatus | null> {
    try {
      const res = await this.api(`/api/session-status?sessionId=${encodeURIComponent(sessionId)}`)
      return res ?? null
    } catch { return null }
  }

  // ── Filesystem ──

  async listDir(dir?: string): Promise<DirListResult> {
    const qs = dir ? `?dir=${encodeURIComponent(dir)}` : ''
    const res = await this.api(`/api/fs/list${qs}`)
    return res.data ?? res
  }

  async quickDirs(): Promise<QuickDir[]> {
    const res = await this.api('/api/fs/quickdirs')
    return res.data ?? res ?? []
  }

  async mkdir(path: string): Promise<{ path: string }> {
    const res = await this.api('/api/fs/mkdir', 'POST', { path })
    return res.data ?? res ?? { path }
  }

  async listTree(dir: string): Promise<FsTreeResult> {
    const res = await this.api(`/api/fs/tree?dir=${encodeURIComponent(dir)}`)
    return res.data ?? res ?? { path: dir, items: [] }
  }

  async readFile(path: string): Promise<FsReadResult> {
    const res = await this.api(`/api/fs/read?path=${encodeURIComponent(path)}`)
    return res.data ?? res ?? { path, size: 0, tooLarge: false, contentType: 'text', mimeType: 'text/plain', content: '' }
  }

  async gitStatus(root: string): Promise<GitStatusResult> {
    const res = await this.api(`/api/git/status?root=${encodeURIComponent(root)}`)
    return res.data ?? res ?? { root, items: [] }
  }

  async gitDiff(root: string, path: string, fullContent = false): Promise<GitDiffResult> {
    const qs = `root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}${fullContent ? '&full=1' : ''}`
    const res = await this.api(`/api/git/diff?${qs}`)
    return res.data ?? res ?? { root, path, diff: '' }
  }

  // ── Thinks ──

  getThinksUrlPrefix(sessionId: string): string | null {
    return `${this._baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/thinks`
  }

  async fetchThinks(url: string): Promise<any> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(res.statusText)
    return res.json()
  }
}
