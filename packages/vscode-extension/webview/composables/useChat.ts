import { reactive, onMounted, onUnmounted } from 'vue';

export interface WorkPathEntry {
  path: string;
  alias: string;
}

export interface RemoteEntry {
  name: string;
  host: string;
  port: number;
  workPaths: WorkPathEntry[];
}

export interface SessionItem {
  id: string;
  name?: string;
  agent: string;
  saver: string;
  memories: string[];
}

export interface AgentOption { id: string; name?: string }
export interface SaverOption { id: string; name: string }
export interface MemoryOption { id: string; name: string }

export interface StoredMessage {
  message: { role: string; content?: string | any[] };
  createdAt?: number;
  thinkId?: string;
}

export interface ChatState {
  phase: 'server-pick' | 'workdir-pick' | 'session-pick' | 'chat';
  online: boolean;
  remotes: RemoteEntry[];
  currentRemote: RemoteEntry | null;
  currentRemoteIndex: number;
  sessions: SessionItem[];
  agents: AgentOption[];
  savers: SaverOption[];
  memories: MemoryOption[];
  workPath: string;
  sessionId: string | null;
  messages: StoredMessage[];
  streamingContent: string;
  isStreaming: boolean;
}

const vscode = acquireVsCodeApi();

export function useChat() {
  const state = reactive<ChatState>({
    phase: 'server-pick',
    online: false,
    remotes: [],
    currentRemote: null,
    currentRemoteIndex: -1,
    sessions: [],
    agents: [],
    savers: [],
    memories: [],
    workPath: '',
    sessionId: null,
    messages: [],
    streamingContent: '',
    isStreaming: false,
  });

  function handleMessage(event: MessageEvent) {
    const msg = event.data;
    switch (msg.type) {
      case 'serverList':
        state.phase = 'server-pick';
        state.remotes = msg.remotes ?? [];
        state.currentRemote = null;
        state.currentRemoteIndex = -1;
        state.online = false;
        state.sessionId = null;
        break;
      case 'workDirList':
        state.phase = 'workdir-pick';
        state.currentRemoteIndex = msg.remoteIndex;
        state.currentRemote = msg.remote;
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
        const chunk = msg.content;
        if (typeof chunk === 'string') {
          state.streamingContent += chunk;
        } else if (chunk?.content) {
          state.streamingContent += typeof chunk.content === 'string' ? chunk.content : '';
        }
        break;
      }
      case 'messageComplete':
        state.messages.push(msg.data);
        break;
      case 'done':
        if (state.streamingContent) {
          state.messages.push({
            message: { role: 'ai', content: state.streamingContent },
            createdAt: Date.now() / 1000,
          });
        }
        state.streamingContent = '';
        state.isStreaming = false;
        break;
      case 'sessionCreated':
        state.sessionId = msg.sessionId;
        state.messages = [];
        state.phase = 'chat';
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

  function selectWorkDir(path: string) {
    vscode.postMessage({ type: 'selectWorkDir', path });
  }

  function addWorkDir(path: string, alias: string) {
    vscode.postMessage({ type: 'addWorkDir', path, alias });
  }

  function updateRemote(remoteIndex: number, patch: { name?: string; host?: string; port?: number }) {
    vscode.postMessage({ type: 'updateRemote', remoteIndex, patch });
  }

  function removeRemote(remoteIndex: number) {
    vscode.postMessage({ type: 'removeRemote', remoteIndex });
  }

  function updateWorkPath(wpIndex: number, patch: { path?: string; alias?: string }) {
    vscode.postMessage({ type: 'updateWorkPath', wpIndex, patch });
  }

  function removeWorkPath(wpIndex: number) {
    vscode.postMessage({ type: 'removeWorkPath', wpIndex });
  }

  function backToServerPick() {
    vscode.postMessage({ type: 'backToServerPick' });
  }

  function selectSession(sessionId: string) {
    state.sessionId = sessionId;
    state.phase = 'chat';
    vscode.postMessage({ type: 'selectSession', sessionId });
  }

  function createSession(agentId: string, saverId: string, memoryIds: string[]) {
    vscode.postMessage({ type: 'createSession', agentId, saverId, memoryIds });
  }

  function sendMessage(text: string) {
    if (!text.trim() || !state.sessionId) return;
    state.messages.push({
      message: { role: 'human', content: text },
      createdAt: Date.now() / 1000,
    });
    state.streamingContent = '';
    state.isStreaming = true;
    vscode.postMessage({ type: 'sendMessage', text });
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
    selectWorkDir,
    addWorkDir,
    updateWorkPath,
    removeWorkPath,
    backToServerPick,
    selectSession,
    createSession,
    sendMessage,
    retry,
  };
}
