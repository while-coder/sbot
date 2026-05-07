import type { IChatTransport, ChatEvent, ContentPart, Attachment, SessionItem, CreateSessionOpts, StoredMessage, UsageInfo, AppSettings, SessionStatus, ToolApprovalPayload, AskAnswerPayload, DirListResult, QuickDir, RemoteEntry } from '@sbot/chat-ui'

declare function acquireVsCodeApi(): { postMessage(msg: any): void }
const vscode = acquireVsCodeApi()

type EventHandler = (event: ChatEvent) => void

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

export class VsCodeTransport implements IChatTransport {
  connect(): void { cmd('connect') }
  disconnect(): void { cmd('disconnect') }
  onEvent(handler: EventHandler): void { handlers.add(handler) }
  offEvent(handler: EventHandler): void { handlers.delete(handler) }

  listSessions(): Promise<SessionItem[]> { return rpc('listSessions') }
  createSession(opts: CreateSessionOpts): Promise<{ id: string }> { return rpc('createSession', opts) }
  deleteSession(sessionId: string): Promise<void> { return rpc('deleteSession', sessionId) }
  updateSession(sessionId: string, patch: Partial<SessionItem>): Promise<void> { return rpc('updateSession', sessionId, patch) }

  sendMessage(sessionId: string, parts: ContentPart[], attachments?: Attachment[]): void { cmd('sendMessage', sessionId, parts, attachments) }
  getHistory(sessionId: string): Promise<StoredMessage[]> { return rpc('getHistory', sessionId) }
  clearHistory(sessionId: string): Promise<void> { return rpc('clearHistory', sessionId) }

  getUsage(sessionId: string): Promise<UsageInfo | null> { return rpc('getUsage', sessionId) }

  approveToolCall(sessionId: string, payload: ToolApprovalPayload): void { cmd('approveToolCall', sessionId, payload) }
  answerAsk(sessionId: string, payload: AskAnswerPayload): void { cmd('answerAsk', sessionId, payload) }
  abort(sessionId: string): void { cmd('abort', sessionId) }

  getSettings(): Promise<AppSettings> { return rpc('getSettings') }
  getSessionStatus(sessionId: string): Promise<SessionStatus | null> { return rpc('getSessionStatus', sessionId) }

  listDir(dir?: string): Promise<DirListResult> { return rpc('listDir', dir) }
  quickDirs(): Promise<QuickDir[]> { return rpc('quickDirs') }
  mkdir(path: string): Promise<{ path: string }> { return rpc('mkdir', path) }

  getThinksUrlPrefix(_sessionId: string): string | null { return null }
  async fetchThinks(url: string): Promise<any> { return rpc('fetchThinks', url) }

  getRemotes(): Promise<RemoteEntry[]> { return rpc('getRemotes') }
  saveRemotes(remotes: RemoteEntry[]): Promise<void> { return rpc('saveRemotes', remotes) }
  connectServer(baseUrl: string): Promise<void> { return rpc('connectServer', baseUrl) }
}

export const transport = new VsCodeTransport()
