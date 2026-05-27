import type {
  ContentPart, Attachment,
  SessionItem, CreateSessionOpts, StoredMessage,
  UsageInfo, AppSettings, SessionStatus,
  ToolApprovalPayload, AskAnswerPayload,
  DirListResult, QuickDir, FsTreeResult, FsReadResult, GitStatusResult, GitDiffResult, ChatEvent,
} from './types';

export interface IChatTransport {
  connect(): void
  disconnect(): void
  onEvent(handler: (event: ChatEvent) => void): void
  offEvent(handler: (event: ChatEvent) => void): void

  listSessions(): Promise<SessionItem[]>
  createSession(opts: CreateSessionOpts): Promise<{ id: string }>
  deleteSession(sessionId: string): Promise<void>
  updateSession(sessionId: string, patch: Partial<SessionItem>): Promise<void>

  sendMessage(sessionId: string, parts: ContentPart[], attachments?: Attachment[]): void
  getHistory(sessionId: string): Promise<StoredMessage[]>
  clearHistory(sessionId: string): Promise<void>

  getUsage(sessionId: string): Promise<UsageInfo | null>

  approveToolCall(sessionId: string, payload: ToolApprovalPayload): void
  answerAsk(sessionId: string, payload: AskAnswerPayload): void
  abort(sessionId: string): void

  getSettings(): Promise<AppSettings>
  getSessionStatus(sessionId: string): Promise<SessionStatus | null>

  listDir(rootId: string, path?: string): Promise<DirListResult>
  quickDirs(): Promise<QuickDir[]>
  mkdir(rootId: string, path: string): Promise<{ rootId: string; path: string }>

  listTree(rootId: string, path?: string): Promise<FsTreeResult>
  readFile(rootId: string, path?: string): Promise<FsReadResult>
  /** 返回可直接下载/在新标签页打开的原始文件 URL；用于 tooLarge 或 binary 等无法在 viewer 中显示的场景 */
  getRawFileUrl(rootId: string, path?: string): string
  gitStatus(root: string): Promise<GitStatusResult>
  gitDiff(root: string, path: string, fullContent?: boolean): Promise<GitDiffResult>

  getThinksUrlPrefix(sessionId: string): string | null
  fetchThinks?(url: string): Promise<any>
}
