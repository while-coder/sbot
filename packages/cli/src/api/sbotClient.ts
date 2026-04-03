import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import WebSocket from 'ws';
import axios, { type AxiosInstance } from 'axios';
import { DEFAULT_PORT, WsCommandType, type Settings, type WebChatEvent } from 'sbot.commons';

export { DEFAULT_PORT, type WebChatEvent } from 'sbot.commons';

export function getServerBaseUrl(): string {
  try {
    const settingsPath = join(homedir(), '.sbot', 'settings.json');
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      const port: number = settings.httpPort ?? DEFAULT_PORT;
      return `http://localhost:${port}`;
    }
  } catch {
    // 读取失败时使用默认端口
  }
  return `http://localhost:${DEFAULT_PORT}`;
}

export interface SbotSettings {
  agents?: Settings['agents'];
  savers?: Settings['savers'];
  memories?: Settings['memories'];
}

export interface SessionItem {
  id: string;
  name?: string;
  agent: string;
  saver: string;
  memories: string[];
  workPath?: string;
}

export interface SessionStatus {
  threadId: string;
  status: 'thinking' | 'waiting_approval' | 'waiting_ask';
  pendingApproval?: {
    id: string;
    tool: { name: string; args: Record<string, any> };
  };
  pendingAsk?: {
    id: string;
    title?: string;
    questions: Array<
      | { type: 'radio'; label: string; options: string[]; allowCustom?: boolean }
      | { type: 'checkbox'; label: string; options: string[]; allowCustom?: boolean }
      | { type: 'input'; label: string; placeholder?: string }
    >;
  };
}

// ── Persistent WebSocket with auto-reconnect ─────────────────────────────────

type WsListener = (event: WebChatEvent & { sessionId?: string }) => void;

class PersistentWs {
  private ws: WebSocket | null = null;
  private readonly wsUrl: string;
  private listeners = new Set<WsListener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(baseUrl: string) {
    this.wsUrl = baseUrl.replace(/^http/, 'ws') + '/ws/chat';
    this.connect();
  }

  private connect(): void {
    if (this.disposed) return;
    const ws = new WebSocket(this.wsUrl);

    ws.on('open', () => {
      this.ws = ws;
    });

    ws.on('message', (data) => {
      try {
        const event = JSON.parse(data.toString());
        for (const listener of this.listeners) listener(event);
      } catch { /* skip malformed */ }
    });

    ws.on('close', () => {
      this.ws = null;
      this.scheduleReconnect();
    });

    ws.on('error', () => {
      // error triggers close, reconnect will happen there
      try { ws.close(); } catch { /* ignore */ }
    });
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2000);
  }

  /** Send a JSON message. Resolves when open, rejects if disposed. */
  send(msg: Record<string, any>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /** Wait until the WS is open, with timeout. */
  async waitReady(timeoutMs = 5000): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WS connect timeout')), timeoutMs);
      const check = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          clearTimeout(timer);
          clearInterval(check);
          resolve();
        }
      }, 50);
    });
  }

  addListener(fn: WsListener): void { this.listeners.add(fn); }
  removeListener(fn: WsListener): void { this.listeners.delete(fn); }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.listeners.clear();
    try { this.ws?.close(); } catch { /* ignore */ }
  }
}

// ── SbotClient ───────────────────────────────────────────────────────────────

export class SbotClient {
  private readonly http: AxiosInstance;
  readonly ws: PersistentWs;

  constructor(baseUrl: string) {
    this.http = axios.create({ baseURL: baseUrl });
    this.ws = new PersistentWs(baseUrl);
  }

  async isOnline(): Promise<boolean> {
    try {
      await this.http.get('/api/settings', { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  async fetchSettings(): Promise<SbotSettings> {
    const res = await this.http.get<{ data: SbotSettings }>('/api/settings');
    return res.data.data;
  }

  /** Fetch sessions filtered by workPath */
  async fetchSessions(workPath: string): Promise<SessionItem[]> {
    const res = await this.http.get<{ data: SessionItem[] }>(
      '/api/sessions', { params: { workPath } },
    );
    return res.data.data;
  }

  /** Create a session on the server and return its ID */
  async createSession(agentId: string, saverId: string, memoryIds: string[], workPath: string): Promise<string> {
    const body: any = {
      agent: agentId,
      saver: saverId,
      memories: memoryIds,
      workPath,
      name: workPath.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || workPath,
    };
    const res = await this.http.post<{ data: { id: string } }>('/api/settings/sessions', body);
    return res.data.data.id;
  }

  /** Fetch current session status (pending approval/ask). Returns null if no active run. */
  async fetchSessionStatus(sessionId: string): Promise<SessionStatus | null> {
    try {
      const res = await this.http.get<SessionStatus | null>(
        '/api/session-status',
        { params: { sessionId } },
      );
      return res.data;
    } catch {
      return null;
    }
  }

  /** Send a command (approval / ask / abort) through the persistent WS. */
  send(sessionId: string, msg: Record<string, any>): void {
    this.ws.send({ ...msg, sessionId });
  }

  /** Open a chat session that uses the persistent WS. */
  openChatSession(
    query: string,
    sessionId: string,
    signal: AbortSignal,
  ): ChatSession {
    return new ChatSession(this, query, sessionId, signal);
  }

  dispose(): void {
    this.ws.dispose();
  }
}

// ── ChatSession (uses shared PersistentWs) ───────────────────────────────────

/**
 * Chat session built on top of the shared persistent WebSocket.
 * Yields server events as an async iterator while allowing
 * mid-stream sends (approval / ask responses).
 */
export class ChatSession {
  private events: WebChatEvent[] = [];
  private resolve: (() => void) | null = null;
  private done = false;
  private error: Error | null = null;
  private listener: WsListener;
  private readonly client: SbotClient;
  private readonly sessionId: string;
  readonly ready: Promise<void>;

  constructor(client: SbotClient, query: string, sessionId: string, signal: AbortSignal) {
    this.client = client;
    this.sessionId = sessionId;

    // Subscribe to events from the shared WS, filtered by sessionId
    this.listener = (event) => {
      if (event.sessionId && event.sessionId !== sessionId) return;
      this.events.push(event);
      this.resolve?.();
    };
    client.ws.addListener(this.listener);

    signal.addEventListener('abort', () => {
      this.cleanup();
      this.error = new Error('AbortError');
      (this.error as any).name = 'AbortError';
      this.resolve?.();
    }, { once: true });

    // Wait for WS to be ready, then send query
    this.ready = client.ws.waitReady().then(() => {
      client.send(sessionId, { type: WsCommandType.Query, query });
    });
  }

  /** Iterate over server events. */
  async *events_iter(): AsyncGenerator<WebChatEvent> {
    await this.ready;
    try {
      while (true) {
        if (this.events.length === 0 && !this.done && !this.error) {
          await new Promise<void>((r) => { this.resolve = r; });
          this.resolve = null;
        }
        if (this.error) throw this.error;
        while (this.events.length > 0) {
          const event = this.events.shift()!;
          yield event;
          if (event.type === 'done') return;
        }
        if (this.done) return;
      }
    } finally {
      this.cleanup();
    }
  }

  /** Send tool-call approval back to server. */
  sendApproval(id: string, approval: string): void {
    this.client.send(this.sessionId, {
      type: WsCommandType.Approval,
      id,
      approval,
    });
  }

  /** Send ask answers back to server. */
  sendAsk(id: string, answers: Record<string, string | string[]>): void {
    this.client.send(this.sessionId, {
      type: WsCommandType.Ask,
      id,
      answers,
    });
  }

  private cleanup(): void {
    this.done = true;
    this.client.ws.removeListener(this.listener);
  }
}
