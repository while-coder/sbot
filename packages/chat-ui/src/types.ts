export interface RemoteEntry {
  name: string;
  host: string;
  port: number;
}

export interface SessionItem {
  id: string;
  name?: string;
  agent: string;
  saver: string;
  memories: string[];
  workPath?: string;
}

export interface AgentOption { id: string; name?: string }
export interface SaverOption { id: string; name: string }
export interface MemoryOption { id: string; name: string }

// ── Message types ──

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
  content?: string | any[]
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

export interface StoredMessage {
  message: ChatMessage
  createdAt?: number
  thinkId?: string
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

// ── Labels (i18n without vue-i18n) ──

export interface ChatLabels {
  send?: string
  inputPlaceholder?: string
  stop?: string
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
  selectSession?: string
  noSession?: string
  newSession?: string
  createSession?: string
}

// ── Chat state ──

export interface ChatState {
  phase: 'server-pick' | 'session-pick' | 'chat';
  online: boolean;
  remotes: RemoteEntry[];
  sessions: SessionItem[];
  agents: AgentOption[];
  savers: SaverOption[];
  memories: MemoryOption[];
  workPath: string;
  sessionId: string | null;
  messages: StoredMessage[];
  streamingContent: string | any[];
  isStreaming: boolean;
  currentAgent: string;
  currentSaver: string;
  currentMemories: string[];
}
