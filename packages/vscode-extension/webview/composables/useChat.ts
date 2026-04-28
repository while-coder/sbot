import { reactive, onMounted, onUnmounted } from 'vue';

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

const vscode = acquireVsCodeApi();

export function useChat() {
  const state = reactive<ChatState>({
    phase: 'server-pick',
    online: false,
    remotes: [],
    sessions: [],
    agents: [],
    savers: [],
    memories: [],
    workPath: '',
    sessionId: null,
    messages: [],
    streamingContent: '',
    isStreaming: false,
    currentAgent: '',
    currentSaver: '',
    currentMemories: [],
  });

  function handleMessage(event: MessageEvent) {
    const msg = event.data;
    switch (msg.type) {
      case 'serverList':
        state.phase = 'server-pick';
        state.remotes = msg.remotes ?? [];
        state.online = false;
        state.sessionId = null;
        break;
      case 'connectionStatus':
        state.online = msg.online;
        break;
      case 'init':
        state.phase = 'session-pick';
        state.sessions = msg.sessions ?? [];
        state.workPath = msg.workPath ?? '';
        if (msg.settings) {
          const s = msg.settings;
          state.agents = Object.entries(s.agents ?? {}).map(([id, v]: [string, any]) => ({ id, name: v.name }));
          state.savers = Object.entries(s.savers ?? {}).map(([id, v]: [string, any]) => ({ id, name: v.name }));
          state.memories = Object.entries(s.memories ?? {}).map(([id, v]: [string, any]) => ({ id, name: v.name }));
        }
        break;
      case 'history':
        state.messages = msg.messages ?? [];
        state.streamingContent = '';
        state.isStreaming = false;
        break;
      case 'humanEcho':
        break;
      case 'streamChunk': {
        state.isStreaming = true;
        const d = msg.content;
        if (typeof d === 'string') {
          state.streamingContent = d;
        } else if (d?.content) {
          state.streamingContent = typeof d.content === 'string' ? d.content : '';
        }
        break;
      }
      case 'messageComplete':
        state.messages.push(msg.data);
        state.streamingContent = '';
        break;
      case 'done':
        state.streamingContent = '';
        state.isStreaming = false;
        break;
      case 'sessionCreated':
        state.sessionId = msg.sessionId;
        state.messages = [];
        state.phase = 'chat';
        if (msg.agent) state.currentAgent = msg.agent;
        if (msg.saver) state.currentSaver = msg.saver;
        if (msg.memories) state.currentMemories = msg.memories;
        break;
      case 'error':
        console.error('[sbot]', msg.message);
        break;
    }
  }

  onMounted(() => window.addEventListener('message', handleMessage));
  onUnmounted(() => window.removeEventListener('message', handleMessage));

  function selectLocal() {
    vscode.postMessage({ type: 'selectLocal' });
  }

  function selectRemote(remoteIndex: number) {
    vscode.postMessage({ type: 'selectRemote', remoteIndex });
  }

  function addRemote(name: string, host: string, port: number) {
    vscode.postMessage({ type: 'addRemote', name, host, port });
  }

  function updateRemote(remoteIndex: number, patch: { name?: string; host?: string; port?: number }) {
    vscode.postMessage({ type: 'updateRemote', remoteIndex, patch });
  }

  function removeRemote(remoteIndex: number) {
    vscode.postMessage({ type: 'removeRemote', remoteIndex });
  }

  function backToServerPick() {
    vscode.postMessage({ type: 'backToServerPick' });
  }

  function selectSession(sessionId: string) {
    state.sessionId = sessionId;
    state.phase = 'chat';
    const session = state.sessions.find(s => s.id === sessionId);
    if (session) {
      state.currentAgent = session.agent;
      state.currentSaver = session.saver;
      state.currentMemories = session.memories ?? [];
    }
    vscode.postMessage({ type: 'selectSession', sessionId });
  }

  function createSession(agentId: string, saverId: string, memoryIds: string[]) {
    vscode.postMessage({ type: 'createSession', agentId, saverId, memoryIds });
  }

  function sendMessage(parts: ContentPart[]) {
    if (parts.length === 0 || !state.sessionId) return;
    const textContent = parts
      .filter(p => p.type === 'text')
      .map(p => (p as any).text)
      .join('\n');
    state.messages.push({
      message: { role: 'human', content: textContent || '[image]' },
      createdAt: Date.now() / 1000,
    });
    state.streamingContent = '';
    state.isStreaming = true;
    vscode.postMessage({ type: 'sendMessage', parts });
  }

  function updateSessionConfig(field: string, value: any) {
    if (!state.sessionId) return;
    if (field === 'agent') state.currentAgent = value;
    else if (field === 'saver') state.currentSaver = value;
    else if (field === 'memories') state.currentMemories = value;
    vscode.postMessage({ type: 'updateSessionConfig', field, value });
  }

  function retry() {
    vscode.postMessage({ type: 'refreshInit' });
  }

  return {
    state,
    selectLocal,
    selectRemote,
    addRemote,
    updateRemote,
    removeRemote,
    backToServerPick,
    selectSession,
    createSession,
    sendMessage,
    updateSessionConfig,
    retry,
  };
}
