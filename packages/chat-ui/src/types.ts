export interface RemoteEntry {
  name: string;
  host: string;
  port: number;
  secure?: boolean;
}

export interface SessionItem {
  id: string
  name?: string
  agent: string
  saver: string
  memories: string[]
  wikis?: string[]
  workPath?: string
  autoApproveAllTools?: boolean
}

export interface AgentOption { id: string; name?: string }
export interface SaverOption { id: string; name: string }
export interface MemoryOption { id: string; name: string }

// ── Message types ──

/** Multimodal message content: a plain string or a list of content parts (text/image_url/…). */
export type DisplayContent = string | any[]

export enum MessageRole {
  Human = 'human',
  AI    = 'ai',
  Tool  = 'tool',
}

export interface ToolCall {
  id: string
  name: string
  args: unknown
}

export interface ChatMessage {
  role: MessageRole | string
  content?: DisplayContent
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

/**
 * 与 scorpio.ai 的 `MessageKind` 保持一致；只列出 UI 关心的取值。
 * - Normal    : 正常历史
 * - Archive   : 已归档（压缩摘要替代后的旧消息）
 * - Exception : 异常记录（不进入 LLM 上下文）
 * - Command   : 指令型回调输出（不进入 LLM 上下文）
 */
export enum MessageKind {
  Normal    = 'normal',
  Archive   = 'archive',
  Exception = 'exception',
  Command   = 'command',
}

export interface StoredMessage {
  id?: number
  message: ChatMessage
  createdAt?: number
  thinkId?: string
  /** 记录种类。`Archive` 默认在前端隐藏。 */
  kind: MessageKind | string
}

// ── Content parts ──

export enum ContentPartType {
  Text  = 'text',
  Image = 'image',
  Audio = 'audio',
}

export interface DisplayPart {
  type: ContentPartType
  text?: string
  url?: string
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; dataUrl: string }
  | { type: 'audio'; dataUrl: string };

// ── Attachment ──

export interface Attachment {
  name: string
  type: string
  dataUrl?: string
  content?: string
}

// ── Labels (i18n without vue-i18n) ──

export interface ChatLabels {
  send?: string
  inputPlaceholder?: string
  stop?: string
  attachment?: string
  addAttachment?: string
  roleUser?: string
  roleAi?: string
  thinking?: string
  think?: string
  toolCalls?: string
  toolResult?: string
  noHistory?: string
  dateToday?: string
  dateYesterday?: string
  queued?: string
  loading?: string
  download?: string
  close?: string
  switchServer?: string
  connected?: string
  disconnected?: string
  connectFailed?: string
  retryConnect?: string
  selectServer?: string
  localServer?: string
  localServerDesc?: string
  addRemoteServer?: string
  namePlaceholder?: string
  save?: string
  cancel?: string
  add?: string
  sessionList?: string
  settings?: string
  selectSession?: string
  noSession?: string
  newSession?: string
  createSession?: string
  confirmDeleteSession?: string
  sessionDeleted?: string
  emptySession?: string
  createSessionHint?: string
  editSessionNameHint?: string
  agent?: string
  storage?: string
  workpath?: string
  workpathPlaceholder?: string
  memory?: string
  wiki?: string
  autoApproveAll?: string
  useChannelDefault?: string
  view?: string
  usageLast?: string
  usageTotal?: string
  usageCache?: string
  usageCacheCreation?: string
  usageSaved?: string
  refresh?: string
  clearHistory?: string
  confirmClearHistory?: string
  historyCleared?: string
  selectPlaceholder?: string
  create?: string
  executeTool?: string
  allow?: string
  alwaysAllowArgs?: string
  alwaysAllowAll?: string
  deny?: string
  askSubmit?: string
  askOther?: string
  askOtherPlaceholder?: string
  selectDirTitle?: string
  myComputer?: string
  upDir?: string
  newFolder?: string
  newFolderPlaceholder?: string
  selectThis?: string
  noSubdirs?: string
  noSaver?: string
  selectOrCreate?: string
  /** 已归档消息行右上角的小角标文案 */
  archivedTag?: string
  /** StatusBar 的「显示已归档」复选框文案 */
  showArchived?: string
  /** 命令型消息行右上角的小角标文案 */
  commandTag?: string
  /** 异常型消息行右上角的小角标文案 */
  exceptionTag?: string
  /** Explorer 文件树根目录未设置时的占位文案 */
  explorerNoRoot?: string
  /** Explorer 文件树根目录提示 */
  explorerPickRootHint?: string
  /** Explorer 文件树空目录文案 */
  explorerEmptyDir?: string
  /** Explorer 未选中文件时的占位文案 */
  explorerSelectFile?: string
  /** Explorer 二进制文件提示 */
  explorerBinaryFile?: string
  /** Explorer 文件过大提示，模板变量 {size} */
  explorerTooLarge?: string
  /** Explorer 切换显示的按钮/工具提示 */
  explorerToggle?: string
}

// ── Wiki option ──
export interface WikiOption { id: string; name: string }

// ── Create session ──
export interface CreateSessionOpts {
  agent?: string
  saver?: string
  memories?: string[]
  wikis?: string[]
  name?: string
  workPath?: string
}

// ── Token usage ──
export interface UsageInfo {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  lastInputTokens: number
  lastOutputTokens: number
  lastTotalTokens: number
  cacheCreationTokens?: number
  cacheReadTokens?: number
}

export interface UsageData {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheCreationTokens?: number
  cacheReadTokens?: number
}

// ── Tool approval ──
export enum ApprovalTimeoutValue {
  Allow = 'allow',
  Deny  = 'deny',
}

export interface ToolCallEvent {
  approvalId: string
  toolCallId?: string
  name: string
  args: Record<string, any>
  /** 剩余秒数；缺省/0 表示无超时，不显示倒计时 */
  remainSec?: number
  /** 超时后默认动作；与 remainSec 配套 */
  timeoutValue?: ApprovalTimeoutValue
}

export enum ToolApproval {
  Allow      = 'allow',
  AlwaysArgs = 'alwaysArgs',
  AlwaysTool = 'alwaysTool',
  Deny       = 'deny',
}

export interface ToolApprovalPayload {
  approvalId: string
  approval: ToolApproval
}

// ── Ask form ──
export enum AskQuestionType {
  Radio    = 'radio',
  Checkbox = 'checkbox',
  Input    = 'input',
}

export interface AskQuestionSpec {
  type: AskQuestionType
  label: string
  options?: string[]
  placeholder?: string
}

export interface AskEvent {
  id: string
  title?: string
  questions: AskQuestionSpec[]
  startedAt?: string
  /** 剩余秒数；缺省/0 表示无超时，不显示倒计时 */
  remainSec?: number
}

export interface AskAnswerPayload {
  askId: string
  answers: Record<string, string | string[]>
}

// ── Directory browser ──
export interface DirListResult {
  path: string
  parent: string | null
  items: string[]
}

export interface QuickDir {
  label: string
  path: string
}

// ── Filesystem tree (Explorer) ──
export interface FsTreeItem {
  name: string
  path: string
  type: 'dir' | 'file'
  size?: number
}

export interface FsTreeResult {
  path: string
  items: FsTreeItem[]
}

export interface FsReadResult {
  path: string
  size: number
  tooLarge: boolean
  contentType: 'text' | 'image' | 'binary'
  mimeType: string
  content: string
  dataUrl?: string
}

// ── App settings ──
export interface AppSettings {
  agents: Record<string, { name?: string; type?: string; model?: string }>
  savers: Record<string, { name: string }>
  memories: Record<string, { name: string; share?: boolean }>
  wikis: Record<string, { name: string }>
  models?: Record<string, { contextWindow?: number }>
}

// ── Session status (pending state on reconnect) ──
export interface SessionStatus {
  pendingApproval?: {
    id: string
    tool: { id?: string; name: string; args: Record<string, any> }
    startedAt: string
    remainSec?: number
    timeoutValue?: ApprovalTimeoutValue
  }
  pendingAsk?: AskEvent & { startedAt: string }
  pendingMessages?: DisplayContent[]
}

// ── Chat events (server → client) ──
export enum ChatEventType {
  ConnectionStatus = 'connectionStatus',
  Human = 'human',
  Stream = 'stream',
  Message = 'message',
  ToolCall = 'toolCall',
  Ask = 'ask',
  Queue = 'queue',
  Done = 'done',
  Error = 'error',
  Usage = 'usage',
}

export type ChatEvent =
  | { type: ChatEventType.ConnectionStatus; online: boolean }
  | { type: ChatEventType.Human; sessionId: string; data: { content: DisplayContent } }
  | { type: ChatEventType.Stream; sessionId: string; data: { content: DisplayContent } }
  | { type: ChatEventType.Message; sessionId: string; data: { message: ChatMessage; thinkId?: string; createdAt: number } }
  | { type: ChatEventType.ToolCall; sessionId: string; data: ToolCallEvent }
  | { type: ChatEventType.Ask; sessionId: string; data: AskEvent }
  | { type: ChatEventType.Queue; sessionId: string; data: { pendingMessages: DisplayContent[] } }
  | { type: ChatEventType.Done; sessionId: string; data: { pendingMessages?: DisplayContent[] } }
  | { type: ChatEventType.Error; sessionId: string; data: { message: string } }
  | { type: ChatEventType.Usage; sessionId: string; data: UsageData }
