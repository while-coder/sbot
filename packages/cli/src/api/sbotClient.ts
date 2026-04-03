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

export class SbotClient {
  private readonly http: AxiosInstance;
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    this.http = axios.create({ baseURL: baseUrl });
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

  /** Open a bidirectional chat session over WebSocket. */
  openChatSession(
    query: string,
    sessionId: string,
    signal: AbortSignal,
  ): ChatSession {
    return new ChatSession(this.baseUrl, query, sessionId, signal);
  }
}

/**
 * Bidirectional WebSocket chat session.
 * Yields server events as an async iterator while allowing
 * mid-stream sends (approval / ask responses).
 */
export class ChatSession {
  private ws: WebSocket;
  private events: WebChatEvent[] = [];
  private resolve: (() => void) | null = null;
  private done = false;
  private error: Error | null = null;
  readonly ready: Promise<void>;

  constructor(baseUrl: string, query: string, private sessionId: string, signal: AbortSignal) {
    const wsUrl = baseUrl.replace(/^http/, 'ws') + '/ws/chat';
    this.ws = new WebSocket(wsUrl);

    this.ws.on('message', (data) => {
      try {
        const event = JSON.parse(data.toString()) as WebChatEvent & { sessionId?: string };
        if (event.sessionId && event.sessionId !== sessionId) return;
        this.events.push(event);
        this.resolve?.();
      } catch { /* skip malformed */ }
    });

    this.ws.on('error', (err) => { this.error = err as Error; this.resolve?.(); });
    this.ws.on('close', () => { this.done = true; this.resolve?.(); });

    signal.addEventListener('abort', () => {
      this.ws.close();
      this.error = new Error('AbortError');
      (this.error as any).name = 'AbortError';
      this.resolve?.();
    }, { once: true });

    this.ready = new Promise<void>((res, reject) => {
      this.ws.on('open', () => {
        this.ws.send(JSON.stringify({ type: WsCommandType.Query, query, sessionId }));
        res();
      });
      this.ws.on('error', reject);
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
      if (this.ws.readyState === WebSocket.OPEN) this.ws.close();
    }
  }

  /** Send tool-call approval back to server. */
  sendApproval(id: string, approval: string): void {
    this.ws.send(JSON.stringify({
      type: WsCommandType.Approval,
      sessionId: this.sessionId,
      id,
      approval,
    }));
  }

  /** Send ask answers back to server. */
  sendAsk(id: string, answers: Record<string, string | string[]>): void {
    this.ws.send(JSON.stringify({
      type: WsCommandType.Ask,
      sessionId: this.sessionId,
      id,
      answers,
    }));
  }

  close(): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.close();
  }
}
