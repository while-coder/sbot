import type { FsUploadOptions, IChatTransport, ShellOption } from './transport'
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
  type DriveEntry,
  type QuickDir,
  type FsTreeResult,
  type FsReadResult,
  type FsWriteResult,
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
        const profileId = msg.profileId
        if (profileId) this.emit({ type: msg.type, profileId: String(profileId), data: msg.data } as ChatEvent)
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
      const e: any = new Error(err.message || err.error || res.statusText)
      e.status = res.status
      throw e
    }
    const text = await res.text()
    return text ? JSON.parse(text) : undefined
  }

  // ── Sessions ──

  async listSessions(): Promise<SessionItem[]> {
    const res = await this.api('/api/profiles')
    return res.data ?? res ?? []
  }

  async createSession(opts: CreateSessionOpts): Promise<{ id: string }> {
    const res = await this.api('/api/settings/profiles', 'POST', opts)
    return { id: res.id ?? res.data?.id }
  }

  async deleteSession(profileId: string): Promise<void> {
    await this.api(`/api/profiles/${encodeURIComponent(profileId)}/history`, 'DELETE').catch(() => {})
    await this.api(`/api/settings/profiles/${encodeURIComponent(profileId)}`, 'DELETE')
  }

  async updateSession(profileId: string, patch: Partial<SessionItem>): Promise<void> {
    await this.api(`/api/settings/profiles/${encodeURIComponent(profileId)}`, 'PUT', patch)
  }

  // ── Messages ──

  sendMessage(profileId: string, parts: ContentPart[], attachments?: Attachment[]): void {
    this.wsSend({
      type: 'query',
      profileId,
      parts,
      attachments: attachments?.length ? attachments : undefined,
    })
  }

  async getHistory(profileId: string): Promise<StoredMessage[]> {
    const res = await this.api(`/api/profiles/${encodeURIComponent(profileId)}/history`)
    return res.data ?? res ?? []
  }

  async clearHistory(profileId: string): Promise<void> {
    await this.api(`/api/profiles/${encodeURIComponent(profileId)}/history`, 'DELETE')
  }

  // ── Usage ──

  async getUsage(profileId: string): Promise<UsageInfo | null> {
    try {
      const res = await this.api(`/api/thread-usage?sessions=${encodeURIComponent(profileId)}`)
      return res.data?.[profileId] ?? null
    } catch { return null }
  }

  // ── Tool approval / Ask / Abort ──

  approveToolCall(profileId: string, payload: ToolApprovalPayload): void {
    this.wsSend({ type: 'approval', profileId, id: payload.approvalId, approval: payload.approval })
  }

  answerAsk(profileId: string, payload: AskAnswerPayload): void {
    this.wsSend({ type: 'ask', profileId, id: payload.askId, answers: payload.answers })
  }

  abort(profileId: string): void {
    this.wsSend({ type: 'abort', profileId })
  }

  // ── Settings ──

  async getSettings(): Promise<AppSettings> {
    const res = await this.api('/api/settings')
    return res.data ?? res ?? { agents: {}, savers: {}, notes: {}, wikis: {} }
  }

  async getSessionStatus(profileId: string): Promise<SessionStatus | null> {
    try {
      const res = await this.api(`/api/session-status?profileId=${encodeURIComponent(profileId)}`)
      return res ?? null
    } catch { return null }
  }

  // ── Filesystem ──

  async listDir(path: string): Promise<DirListResult> {
    const res = await this.api(`/api/fs/list?path=${encodeURIComponent(path)}`)
    return res.data ?? res
  }

  async quickDirs(): Promise<QuickDir[]> {
    const res = await this.api('/api/fs/quickdirs')
    return res.data ?? res ?? []
  }

  async listDrives(): Promise<DriveEntry[]> {
    const res = await this.api('/api/fs/drives')
    return res.data ?? res ?? []
  }

  async mkdir(path: string): Promise<{ path: string }> {
    const res = await this.api('/api/fs/mkdir', 'POST', { path })
    return res.data ?? res ?? { path }
  }

  async deleteEntry(path: string): Promise<{ path: string }> {
    const res = await this.api(`/api/fs/entry?path=${encodeURIComponent(path)}`, 'DELETE')
    return res.data ?? res ?? { path }
  }

  async uploadFile(parentDir: string, file: File, options: FsUploadOptions = {}): Promise<{ path: string; size: number }> {
    const fd = new FormData()
    fd.append('dir', parentDir)
    fd.append('file', file, file.name)
    if (options.overwrite) fd.append('overwrite', '1')
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${this._baseUrl}/api/fs/upload`)

      xhr.upload.onprogress = (evt) => {
        const total = evt.lengthComputable ? evt.total : file.size
        const loaded = Math.min(evt.loaded, total || evt.loaded)
        const percent = total > 0 ? Math.round((loaded / total) * 100) : 100
        options.onProgress?.({ loaded, total, percent })
      }

      xhr.onload = () => {
        const text = xhr.responseText || ''
        let json: any
        try {
          json = text ? JSON.parse(text) : undefined
        } catch {
          json = undefined
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          const e: any = new Error(json?.message || json?.error || xhr.statusText)
          e.status = xhr.status
          reject(e)
          return
        }
        options.onProgress?.({ loaded: file.size, total: file.size, percent: 100 })
        resolve(json?.data ?? json)
      }
      xhr.onerror = () => reject(new Error('Upload failed'))
      xhr.onabort = () => reject(new Error('Upload aborted'))
      xhr.send(fd)
    })
  }

  async listTree(path: string): Promise<FsTreeResult> {
    const res = await this.api(`/api/fs/entry?type=tree&path=${encodeURIComponent(path)}`)
    return res.data ?? res ?? { path, items: [] }
  }

  async readFile(path: string): Promise<FsReadResult> {
    const res = await this.api(`/api/fs/entry?type=read&path=${encodeURIComponent(path)}`)
    return res.data ?? res ?? { path, size: 0, tooLarge: false, contentType: 'text', mimeType: 'text/plain', content: '' }
  }

  async writeFile(path: string, content: string, expectedMtime?: number): Promise<FsWriteResult> {
    const res = await this.api('/api/fs/entry', 'PUT', { path, content, expectedMtime })
    return res.data ?? res
  }

  getRawFileUrl(path: string): string {
    return `${this._baseUrl}/api/fs/entry/raw?path=${encodeURIComponent(path)}`
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

  getThinksUrlPrefix(profileId: string): string | null {
    return `${this._baseUrl}/api/profiles/${encodeURIComponent(profileId)}/thinks`
  }

  getTasksUrlPrefix(profileId: string): string | null {
    return `${this._baseUrl}/api/profiles/${encodeURIComponent(profileId)}/tasks`
  }

  async fetchThinks(url: string): Promise<any> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(res.statusText)
    return res.json()
  }

  // ── Pty (terminal) ──

  async listShells(): Promise<ShellOption[]> {
    const res = await this.api('/api/pty/shells')
    return res?.data ?? res ?? []
  }

  openPty(): WebSocket {
    const url = this._baseUrl ? new URL(this._baseUrl) : location
    const proto = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return new WebSocket(`${proto}//${url.host}/ws/pty`)
  }
}
