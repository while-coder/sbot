import { reactive } from 'vue';
import type { ChatState, ContentPart } from './types';

export interface IChatTransport {
  selectLocal(): void;
  selectRemote(remoteIndex: number): void;
  addRemote(name: string, host: string, port: number): void;
  updateRemote(remoteIndex: number, patch: { name?: string; host?: string; port?: number }): void;
  removeRemote(remoteIndex: number): void;
  backToServerPick(): void;
  selectSession(sessionId: string): void;
  createSession(agentId: string, saverId: string, memoryIds: string[]): void;
  sendMessage(parts: ContentPart[]): void;
  updateSessionConfig(field: string, value: any): void;
  retry(): void;
}

export function useChat(transport: IChatTransport) {
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

  function handleMessage(msg: any) {
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

  function selectLocal() { transport.selectLocal(); }
  function selectRemote(remoteIndex: number) { transport.selectRemote(remoteIndex); }
  function addRemote(name: string, host: string, port: number) { transport.addRemote(name, host, port); }
  function updateRemote(remoteIndex: number, patch: { name?: string; host?: string; port?: number }) { transport.updateRemote(remoteIndex, patch); }
  function removeRemote(remoteIndex: number) { transport.removeRemote(remoteIndex); }
  function backToServerPick() { transport.backToServerPick(); }

  function selectSession(sessionId: string) {
    state.sessionId = sessionId;
    state.phase = 'chat';
    const session = state.sessions.find(s => s.id === sessionId);
    if (session) {
      state.currentAgent = session.agent;
      state.currentSaver = session.saver;
      state.currentMemories = session.memories ?? [];
    }
    transport.selectSession(sessionId);
  }

  function createSession(agentId: string, saverId: string, memoryIds: string[]) {
    transport.createSession(agentId, saverId, memoryIds);
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
    transport.sendMessage(parts);
  }

  function updateSessionConfig(field: string, value: any) {
    if (!state.sessionId) return;
    if (field === 'agent') state.currentAgent = value;
    else if (field === 'saver') state.currentSaver = value;
    else if (field === 'memories') state.currentMemories = value;
    transport.updateSessionConfig(field, value);
  }

  function retry() { transport.retry(); }

  return {
    state,
    handleMessage,
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

export type ChatInstance = ReturnType<typeof useChat>;
