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
  uploadFile(parentDir: string, file: File, options?: FsUploadOptions): Promise<{ path: string; size: number }>

  listTree(path: string): Promise<FsTreeResult>
  readFile(path: string): Promise<FsReadResult>
  /** 覆写文本文件；expectedMtime 用于并发冲突检测（不传则强制覆写） */
  writeFile(path: string, content: string, expectedMtime?: number): Promise<FsWriteResult>
  /** 返回可直接下载/在新标签页打开的原始文件 URL；用于 tooLarge 或 binary 等无法在 viewer 中显示的场景 */
  getRawFileUrl(path: string): string
  /**
   * 触发把文件下载/保存到用户本地。由 transport 决定具体方式（浏览器直接下载 vs 宿主弹保存对话框）。
   * 不实现时回退到 getRawFileUrl 的链接方式。
   */
  downloadFile?(path: string): Promise<void>
  gitStatus(root: string): Promise<GitStatusResult>
  gitDiff(root: string, path: string, fullContent?: boolean): Promise<GitDiffResult>

  getThinksUrlPrefix(profileId: string): string | null
  getTasksUrlPrefix?(profileId: string): string | null
  fetchThinks?(url: string): Promise<any>

  /** List shells available on the server. */
  listShells?(): Promise<ShellOption[]>
  /** Open a fresh WebSocket bound to a single pty session. The caller owns its lifecycle. */
  openPty?(): WebSocket

  /** 可用斜杠命令列表，供输入框自动补全菜单使用；不实现时前端不弹菜单。 */
  listCommands?(): Promise<CommandInfo[]>
}

export interface CommandInfo {
  name: string
  description: string
  args?: { name: string; description: string; required: boolean }[]
}

export interface FsUploadProgress {
  loaded: number
  total: number
  percent: number
}

export interface FsUploadOptions {
  overwrite?: boolean
  onProgress?: (progress: FsUploadProgress) => void
}

export interface ShellOption {
  id: string
  label: string
  path: string
}
