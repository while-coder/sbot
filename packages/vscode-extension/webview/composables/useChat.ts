import type { IChatTransport, ChatEvent, ContentPart, Attachment, SessionItem, CreateSessionOpts, StoredMessage, UsageInfo, AppSettings, SessionStatus, ToolApprovalPayload, AskAnswerPayload, DirListResult, DriveEntry, QuickDir, FsTreeResult, FsReadResult, FsWriteResult, GitStatusResult, GitDiffResult, RemoteEntry, FsUploadOptions, FsUploadProgress } from '@sbot/chat-ui'

declare function acquireVsCodeApi(): { postMessage(msg: any): void }
const vscode = acquireVsCodeApi()

type EventHandler = (event: ChatEvent) => void
type VscodeUploadFilePayload = { name: string; type: string; size: number; dataUrl: string }

let rpcId = 0
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
const handlers = new Set<EventHandler>()

window.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data
  if (msg.type === 'rpc-result') {
    const p = pending.get(msg.id)
    if (p) { pending.delete(msg.id); p.resolve(msg.result) }
  } else if (msg.type === 'rpc-error') {
    const p = pending.get(msg.id)
    if (p) { pending.delete(msg.id); p.reject(new Error(msg.error)) }
  } else if (msg.type === 'event') {
    handlers.forEach(h => h(msg.event))
  }
})

function rpc(method: string, ...args: any[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = ++rpcId
    pending.set(id, { resolve, reject })
    vscode.postMessage({ type: 'rpc', id, method, args: JSON.parse(JSON.stringify(args)) })
  })
}

function cmd(method: string, ...args: any[]) {
  vscode.postMessage({ type: 'cmd', method, args: JSON.parse(JSON.stringify(args)) })
}

function readFileAsDataUrl(file: File, onProgress?: (progress: FsUploadProgress) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onprogress = (evt) => {
      const total = evt.lengthComputable ? evt.total : file.size
      const loaded = Math.min(evt.loaded, total || evt.loaded)
      const percent = total > 0 ? Math.min(95, Math.round((loaded / total) * 95)) : 95
      onProgress?.({ loaded, total, percent })
    }
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.onabort = () => reject(new Error('File read aborted'))
    reader.readAsDataURL(file)
  })
}

export class VsCodeTransport implements IChatTransport {
  connect(): void { cmd('connect') }
  disconnect(): void { cmd('disconnect') }
  onEvent(handler: EventHandler): void { handlers.add(handler) }
  offEvent(handler: EventHandler): void { handlers.delete(handler) }

  listSessions(): Promise<SessionItem[]> { return rpc('listSessions') }
  createSession(opts: CreateSessionOpts): Promise<{ id: string }> { return rpc('createSession', opts) }
  deleteSession(profileId: string): Promise<void> { return rpc('deleteSession', profileId) }
  updateSession(profileId: string, patch: Partial<SessionItem>): Promise<void> { return rpc('updateSession', profileId, patch) }

  sendMessage(profileId: string, parts: ContentPart[], attachments?: Attachment[]): void { cmd('sendMessage', profileId, parts, attachments) }
  getHistory(profileId: string): Promise<StoredMessage[]> { return rpc('getHistory', profileId) }
  clearHistory(profileId: string): Promise<void> { return rpc('clearHistory', profileId) }

  getUsage(profileId: string): Promise<UsageInfo | null> { return rpc('getUsage', profileId) }

  approveToolCall(profileId: string, payload: ToolApprovalPayload): void { cmd('approveToolCall', profileId, payload) }
  answerAsk(profileId: string, payload: AskAnswerPayload): void { cmd('answerAsk', profileId, payload) }
  abort(profileId: string): void { cmd('abort', profileId) }

  getSettings(): Promise<AppSettings> { return rpc('getSettings') }
  getSessionStatus(profileId: string): Promise<SessionStatus | null> { return rpc('getSessionStatus', profileId) }

  listDir(path: string): Promise<DirListResult> { return rpc('listDir', path) }
  quickDirs(): Promise<QuickDir[]> { return rpc('quickDirs') }
  listDrives(): Promise<DriveEntry[]> { return rpc('listDrives') }
  mkdir(path: string): Promise<{ path: string }> { return rpc('mkdir', path) }
  deleteEntry(path: string): Promise<{ path: string }> { return rpc('deleteEntry', path) }
  async uploadFile(parentDir: string, file: File, options: FsUploadOptions = {}): Promise<{ path: string; size: number }> {
    options.onProgress?.({ loaded: 0, total: file.size, percent: 0 })
    const payload: VscodeUploadFilePayload = {
      name: file.name,
      type: file.type,
      size: file.size,
      dataUrl: await readFileAsDataUrl(file, options.onProgress),
    }
    const result = await rpc('uploadFile', parentDir, payload, { overwrite: Boolean(options.overwrite) })
    options.onProgress?.({ loaded: file.size, total: file.size, percent: 100 })
    return result
  }
  listTree(path: string): Promise<FsTreeResult> { return rpc('listTree', path) }
  readFile(path: string): Promise<FsReadResult> { return rpc('readFile', path) }
  writeFile(path: string, content: string, expectedMtime?: number): Promise<FsWriteResult> { return rpc('writeFile', path, content, expectedMtime) }
  getRawFileUrl(_path: string): string { return '' }
  gitStatus(root: string): Promise<GitStatusResult> { return rpc('gitStatus', root) }
  gitDiff(root: string, path: string, fullContent = false): Promise<GitDiffResult> { return rpc('gitDiff', root, path, fullContent) }

  getThinksUrlPrefix(profileId: string): string | null { return `/api/profiles/${encodeURIComponent(profileId)}/thinks` }
  async fetchThinks(url: string): Promise<any> { return rpc('fetchThinks', url) }

  getRemotes(): Promise<RemoteEntry[]> { return rpc('getRemotes') }
  saveRemotes(remotes: RemoteEntry[]): Promise<void> { return rpc('saveRemotes', remotes) }
  connectServer(baseUrl: string, local?: boolean): Promise<void> { return rpc('connectServer', baseUrl, local ?? false) }
  getLastServer(): Promise<{ url: string; local: boolean } | null> { return rpc('getLastServer') }
}

export const transport = new VsCodeTransport()
