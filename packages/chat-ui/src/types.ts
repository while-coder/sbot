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

export interface StoredMessage {
  message: { role: string; content?: string | any[] };
  createdAt?: number;
  thinkId?: string;
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; dataUrl: string };

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
  streamingContent: string;
  isStreaming: boolean;
  currentAgent: string;
  currentSaver: string;
  currentMemories: string[];
}
