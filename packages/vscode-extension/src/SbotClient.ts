import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import WebSocket from 'ws';
import axios, { type AxiosInstance } from 'axios';
import {
  DEFAULT_PORT,
  WsCommandType,
  WebChatEventType,
  type Settings,
  type WebChatEvent,
  type StoredMessage,
} from 'sbot.commons';

export type WsListener = (event: WebChatEvent & { sessionId?: string }) => void;

export interface SessionItem {
  id: string;
  name?: string;
  agent: string;
  saver: string;
  memories: string[];
  workPath?: string;
}

export interface SbotSettings {
  agents?: Settings['agents'];
  savers?: Settings['savers'];
  memories?: Settings['memories'];
}

function getServerBaseUrl(): string {
  try {
    const settingsPath = join(homedir(), '.sbot', 'settings.json');
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      const port: number = settings.httpPort ?? DEFAULT_PORT;
      return `http://localhost:${port}`;
    }
  } catch { /* use default */ }
  return `http://localhost:${DEFAULT_PORT}`;
}

export class SbotClient {
  private readonly http: AxiosInstance;
  private ws: WebSocket | null = null;
  private readonly wsUrl: string;
  private listeners = new Set<WsListener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? getServerBaseUrl();
    this.http = axios.create({ baseURL: this.baseUrl });
    this.wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/ws/chat';
    this.connect();
  }

  private connect(): void {
    if (this.disposed) return;
    const ws = new WebSocket(this.wsUrl);
    ws.on('open', () => { this.ws = ws; });
    ws.on('message', (data) => {
      try {
        const event = JSON.parse(data.toString());
        for (const fn of this.listeners) fn(event);
      } catch { /* skip */ }
    });
    ws.on('close', () => { this.ws = null; this.scheduleReconnect(); });
    ws.on('error', () => { try { ws.close(); } catch { /* ignore */ } });
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }

  async isOnline(): Promise<boolean> {
    try {
      await this.http.get('/api/settings', { timeout: 3000 });
      return true;
    } catch { return false; }
  }

  async fetchSettings(): Promise<SbotSettings> {
    const res = await this.http.get<{ data: SbotSettings }>('/api/settings');
    return res.data.data;
  }

  async fetchSessions(workPath?: string): Promise<SessionItem[]> {
    const params = workPath ? { workPath } : {};
    const res = await this.http.get<{ data: SessionItem[] }>('/api/sessions', { params });
    return res.data.data;
  }

  async createSession(agentId: string, saverId: string, memoryIds: string[], workPath: string): Promise<string> {
    const body = {
      agent: agentId, saver: saverId, memories: memoryIds, workPath,
      name: workPath.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || workPath,
    };
    const res = await this.http.post<{ data: { id: string } }>('/api/settings/sessions', body);
    return res.data.data.id;
  }

  async fetchHistory(sessionId: string): Promise<StoredMessage[]> {
    const res = await this.http.get<{ data: StoredMessage[] }>('/api/messages', { params: { sessionId } });
    return res.data.data ?? [];
  }

  send(sessionId: string, msg: Record<string, any>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ ...msg, sessionId }));
    }
  }

  sendQuery(sessionId: string, text: string): void {
    this.send(sessionId, {
      type: WsCommandType.Query,
      parts: [{ type: 'text', text }],
    });
  }

  sendParts(sessionId: string, parts: Array<{ type: string; text?: string; dataUrl?: string }>): void {
    this.send(sessionId, {
      type: WsCommandType.Query,
      parts,
    });
  }

  async updateSession(sessionId: string, patch: Record<string, any>): Promise<void> {
    await this.http.put(`/api/settings/sessions/${encodeURIComponent(sessionId)}`, patch);
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
