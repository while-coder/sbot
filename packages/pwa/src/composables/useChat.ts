import { onUnmounted, ref, computed } from 'vue';
import { useChat as useChatCore, type IChatTransport, type ContentPart } from '@sbot/chat-ui';
import { WsCommandType, WebChatEventType, DEFAULT_PORT } from 'sbot.commons';

const REMOTES_KEY = 'sbot-pwa-remotes';

interface RemoteEntry { name: string; host: string; port: number }

function loadRemotes(): RemoteEntry[] {
  try { return JSON.parse(localStorage.getItem(REMOTES_KEY) || '[]'); }
  catch { return []; }
}
function saveRemotes(remotes: RemoteEntry[]) {
  localStorage.setItem(REMOTES_KEY, JSON.stringify(remotes));
}

export function useChat() {
  const baseUrl = ref('');
  let ws: WebSocket | null = null;
  let sessionId: string | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const remotes = ref<RemoteEntry[]>(loadRemotes());

  const transport: IChatTransport = {
    selectLocal() {
      switchServer(`http://localhost:${DEFAULT_PORT}`);
    },
    selectRemote(remoteIndex: number) {
      const r = remotes.value[remoteIndex];
      if (!r) return;
      switchServer(`http://${r.host}:${r.port}`);
    },
    addRemote(name: string, host: string, port: number) {
      remotes.value.push({ name, host, port });
      saveRemotes(remotes.value);
      switchServer(`http://${host}:${port}`);
    },
    cancel() {
      if (!sessionId || !ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: WsCommandType.Abort, sessionId }));
    },
    updateRemote(remoteIndex: number, patch: { name?: string; host?: string; port?: number }) {
      const r = remotes.value[remoteIndex];
      if (!r) return;
      Object.assign(r, patch);
      saveRemotes(remotes.value);
      chat.handleMessage({ type: 'serverList', remotes: remotes.value });
    },
    removeRemote(remoteIndex: number) {
      remotes.value.splice(remoteIndex, 1);
      saveRemotes(remotes.value);
      chat.handleMessage({ type: 'serverList', remotes: remotes.value });
    },
    backToServerPick() {
      closeWs();
      sessionId = null;
      chat.handleMessage({ type: 'serverList', remotes: remotes.value });
    },
    selectSession(sid: string) {
      sessionId = sid;
      fetchHistory(sid);
    },
    createSession(agentId: string, saverId: string, memoryIds: string[]) {
      createSessionOnServer(agentId, saverId, memoryIds);
    },
    sendMessage(parts: ContentPart[], attachments?: any[]) {
      if (!sessionId || !ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ sessionId, type: WsCommandType.Query, parts, attachments }));
    },
    updateSessionConfig(field: string, value: any) {
      if (!sessionId) return;
      const patch: Record<string, any> = {};
      patch[field] = value;
      apiFetch(`/api/settings/sessions/${encodeURIComponent(sessionId)}`, { method: 'PUT', body: patch }).catch(console.error);
    },
    retry() {
      if (baseUrl.value) sendInit();
      else chat.handleMessage({ type: 'serverList', remotes: remotes.value });
    },
  };

  const chat = useChatCore(transport);

  async function apiFetch(path: string, opts?: { method?: string; body?: any }) {
    const url = baseUrl.value + path;
    const init: RequestInit = { method: opts?.method ?? 'GET', headers: { 'Content-Type': 'application/json' } };
    if (opts?.body) init.body = JSON.stringify(opts.body);
    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  }

  function switchServer(url: string) {
    baseUrl.value = url;
    closeWs();
    sessionId = null;
    connectWs();
    sendInit();
  }

  async function sendInit() {
    try {
      await apiFetch('/api/settings');
      chat.handleMessage({ type: 'connectionStatus', online: true });
    } catch {
      chat.handleMessage({ type: 'connectionStatus', online: false });
      return;
    }
    const [settingsRes, sessionsRes] = await Promise.all([
      apiFetch('/api/settings'),
      apiFetch('/api/sessions'),
    ]);
    chat.handleMessage({
      type: 'init',
      settings: settingsRes.data,
      sessions: sessionsRes.data,
      workPath: '',
    });
  }

  async function fetchHistory(sid: string) {
    try {
      const res = await apiFetch(`/api/sessions/${encodeURIComponent(sid)}/history`);
      chat.handleMessage({ type: 'history', messages: res.data ?? [] });
    } catch (e: any) {
      console.error('fetchHistory error', e);
    }
  }

  async function createSessionOnServer(agentId: string, saverId: string, memoryIds: string[]) {
    try {
      const res = await apiFetch('/api/settings/sessions', {
        method: 'POST',
        body: { agent: agentId, saver: saverId, memories: memoryIds, workPath: '', name: 'pwa' },
      });
      sessionId = res.data.id;
      chat.handleMessage({
        type: 'sessionCreated',
        sessionId: res.data.id,
        agent: agentId,
        saver: saverId,
        memories: memoryIds,
      });
    } catch (e: any) {
      console.error('createSession error', e);
    }
  }

  function connectWs() {
    if (!baseUrl.value) return;
    const wsUrl = baseUrl.value.replace(/^http/, 'ws') + '/ws/chat';
    const socket = new WebSocket(wsUrl);
    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.sessionId && msg.sessionId !== sessionId) return;
        switch (msg.type) {
          case WebChatEventType.Stream:
            chat.handleMessage({ type: 'streamChunk', content: msg.data });
            break;
          case WebChatEventType.Message:
            chat.handleMessage({ type: 'messageComplete', data: msg.data });
            break;
          case WebChatEventType.Human:
            chat.handleMessage({ type: 'humanEcho', data: msg.data });
            break;
          case WebChatEventType.Done:
            chat.handleMessage({ type: 'done', data: msg.data });
            break;
          case WebChatEventType.Error:
            chat.handleMessage({ type: 'error', message: msg.data?.message });
            break;
        }
      } catch { /* ignore parse errors */ }
    };
    socket.onclose = () => { ws = null; scheduleReconnect(); };
    socket.onerror = () => { try { socket.close(); } catch {} };
    socket.onopen = () => { ws = socket; };
  }

  function closeWs() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    try { ws?.close(); } catch {}
    ws = null;
  }

  function scheduleReconnect() {
    if (reconnectTimer || !baseUrl.value) return;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connectWs(); }, 3000);
  }

  chat.handleMessage({ type: 'serverList', remotes: remotes.value });

  onUnmounted(() => { closeWs(); });

  const thinksUrlPrefix = computed(() => {
    const sid = chat.state.sessionId;
    if (!sid || !baseUrl.value) return null;
    return `${baseUrl.value}/api/sessions/${encodeURIComponent(sid)}/thinks`;
  });

  async function pwaFetchFn(url: string) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  }

  return { ...chat, thinksUrlPrefix, fetchFn: pwaFetchFn };
}
