import type {
  ContentPart, Attachment,
  SessionItem, CreateSessionOpts, StoredMessage,
  UsageInfo, AppSettings, SessionStatus,
  ToolApprovalPayload, AskAnswerPayload,
  DirListResult, QuickDir, ChatEvent,
} from './types';

export interface IChatTransport {
  connect(): void
  disconnect(): void
  onEvent(handler: (event: ChatEvent) => void): void
  offEvent(handler: (event: ChatEvent) => void): void

  listSessions(): Promise<Record<string, SessionItem>>
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

  listDir(dir?: string): Promise<DirListResult>
  quickDirs(): Promise<QuickDir[]>
  mkdir(path: string): Promise<{ path: string }>

  getThinksUrlPrefix(sessionId: string): string | null
  fetchThinks?(url: string): Promise<any>
}
