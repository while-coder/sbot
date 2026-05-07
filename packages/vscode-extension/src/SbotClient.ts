import WebSocket from 'ws';
import axios, { type AxiosInstance } from 'axios';
import {
  DEFAULT_PORT,
  WsCommandType,
  type WebChatEvent,
} from 'sbot.commons';

export type WsListener = (event: WebChatEvent & { sessionId?: string }) => void;

function getServerBaseUrl(): string {
  const { readFileSync, existsSync } = require('node:fs');
  const { join } = require('node:path');
  const { homedir } = require('node:os');
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

  // ── Settings ──

  async fetchSettings(): Promise<any> {
    const res = await this.http.get('/api/settings');
    return res.data.data ?? res.data ?? {};
  }

  // ── Sessions ──

  async fetchSessions(): Promise<any[]> {
    const res = await this.http.get('/api/sessions');
    return res.data.data ?? res.data ?? [];
  }

  async createSessionNew(opts: { agent: string; saver: string; memories?: string[]; wikis?: string[]; name?: string; workPath?: string }): Promise<{ id: string }> {
    const res = await this.http.post('/api/settings/sessions', opts);
    return { id: res.data.data?.id ?? res.data.id };
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.http.delete(`/api/settings/sessions/${encodeURIComponent(sessionId)}`);
    await this.http.delete(`/api/sessions/${encodeURIComponent(sessionId)}/history`).catch(() => {});
  }

  async updateSession(sessionId: string, patch: Record<string, any>): Promise<void> {
    await this.http.put(`/api/settings/sessions/${encodeURIComponent(sessionId)}`, patch);
  }

  // ── Messages ──

  async fetchHistory(sessionId: string): Promise<any[]> {
    const res = await this.http.get(`/api/sessions/${encodeURIComponent(sessionId)}/history`);
    return res.data.data ?? res.data ?? [];
  }

  async clearHistory(sessionId: string): Promise<void> {
    await this.http.delete(`/api/sessions/${encodeURIComponent(sessionId)}/history`);
  }

  // ── Usage ──

  async getUsage(sessionId: string): Promise<any> {
    try {
      const res = await this.http.get(`/api/thread-usage?sessions=${encodeURIComponent(sessionId)}`);
      return res.data.data?.[sessionId] ?? null;
    } catch { return null; }
  }

  // ── Session status ──

  async getSessionStatus(sessionId: string): Promise<any> {
    try {
      const res = await this.http.get(`/api/session-status?sessionId=${encodeURIComponent(sessionId)}`);
      return res.data ?? null;
    } catch { return null; }
  }

  // ── Filesystem ──

  async listDir(dir?: string): Promise<any> {
    const qs = dir ? `?dir=${encodeURIComponent(dir)}` : '';
    const res = await this.http.get(`/api/fs/list${qs}`);
    return res.data.data ?? res.data;
  }

  async quickDirs(): Promise<any[]> {
    const res = await this.http.get('/api/fs/quickdirs');
    return res.data.data ?? res.data ?? [];
  }

  async mkdir(path: string): Promise<{ path: string }> {
    const res = await this.http.post('/api/fs/mkdir', { path });
    return res.data.data ?? res.data ?? { path };
  }

  // ── Thinks ──

  async fetchThinks(url: string): Promise<any> {
    const res = await this.http.get(url);
    return res.data;
  }

  // ── WebSocket commands ──

  send(sessionId: string, msg: Record<string, any>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ ...msg, sessionId }));
    }
  }

  sendParts(sessionId: string, parts: any[], attachments?: any[]): void {
    this.send(sessionId, {
      type: WsCommandType.Query,
      parts,
      attachments: attachments?.length ? attachments : undefined,
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
