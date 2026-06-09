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
  deleteSession(profileId: string): Promise<void>
  updateSession(profileId: string, patch: Partial<SessionItem>): Promise<void>

  sendMessage(profileId: string, parts: ContentPart[], attachments?: Attachment[]): void
  getHistory(profileId: string): Promise<StoredMessage[]>
  clearHistory(profileId: string): Promise<void>

  getUsage(profileId: string): Promise<UsageInfo | null>

  approveToolCall(profileId: string, payload: ToolApprovalPayload): void
  answerAsk(profileId: string, payload: AskAnswerPayload): void
  abort(profileId: string): void

  getSettings(): Promise<AppSettings>
  getSessionStatus(profileId: string): Promise<SessionStatus | null>

  listDir(path: string): Promise<DirListResult>
  quickDirs(): Promise<QuickDir[]>
  listDrives(): Promise<DriveEntry[]>
  mkdir(path: string): Promise<{ path: string }>
  /** 删除文件或目录（目录递归删除） */
  deleteEntry(path: string): Promise<{ path: string }>
  /** 上传单个文件到指定父目录；目标已存在则失败 */
  uploadFile(parentDir: string, file: File, onProgress?: (progress: FsUploadProgress) => void): Promise<{ path: string; size: number }>

  listTree(path: string): Promise<FsTreeResult>
  readFile(path: string): Promise<FsReadResult>
  /** 覆写文本文件；expectedMtime 用于并发冲突检测（不传则强制覆写） */
  writeFile(path: string, content: string, expectedMtime?: number): Promise<FsWriteResult>
  /** 返回可直接下载/在新标签页打开的原始文件 URL；用于 tooLarge 或 binary 等无法在 viewer 中显示的场景 */
  getRawFileUrl(path: string): string
  gitStatus(root: string): Promise<GitStatusResult>
  gitDiff(root: string, path: string, fullContent?: boolean): Promise<GitDiffResult>

  getThinksUrlPrefix(profileId: string): string | null
  getTasksUrlPrefix?(profileId: string): string | null
  fetchThinks?(url: string): Promise<any>

  /** List shells available on the server. */
  listShells?(): Promise<ShellOption[]>
  /** Open a fresh WebSocket bound to a single pty session. The caller owns its lifecycle. */
  openPty?(): WebSocket
}

export interface FsUploadProgress {
  loaded: number
  total: number
  percent: number
}

export interface ShellOption {
  id: string
  label: string
  path: string
}
