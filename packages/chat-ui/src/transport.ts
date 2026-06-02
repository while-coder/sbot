import type {
  ContentPart, Attachment,
  SessionItem, CreateSessionOpts, StoredMessage,
  UsageInfo, AppSettings, SessionStatus,
  ToolApprovalPayload, AskAnswerPayload,
  DirListResult, DriveEntry, QuickDir, FsTreeResult, FsReadResult, FsWriteResult, GitStatusResult, GitDiffResult, ChatEvent,
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

  listDir(path: string): Promise<DirListResult>
  quickDirs(): Promise<QuickDir[]>
  listDrives(): Promise<DriveEntry[]>
  mkdir(path: string): Promise<{ path: string }>

  listTree(path: string): Promise<FsTreeResult>
  readFile(path: string): Promise<FsReadResult>
  /** 覆写文本文件；expectedMtime 用于并发冲突检测（不传则强制覆写） */
  writeFile(path: string, content: string, expectedMtime?: number): Promise<FsWriteResult>
  /** 返回可直接下载/在新标签页打开的原始文件 URL；用于 tooLarge 或 binary 等无法在 viewer 中显示的场景 */
  getRawFileUrl(path: string): string
  gitStatus(root: string): Promise<GitStatusResult>
  gitDiff(root: string, path: string, fullContent?: boolean): Promise<GitDiffResult>

  getThinksUrlPrefix(sessionId: string): string | null
  getTasksUrlPrefix?(sessionId: string): string | null
  fetchThinks?(url: string): Promise<any>

  /** List shells available on the server. */
  listShells?(): Promise<ShellOption[]>
  /** Open a fresh WebSocket bound to a single pty session. The caller owns its lifecycle. */
  openPty?(): WebSocket
}

export interface ShellOption {
  id: string
  label: string
  path: string
}
