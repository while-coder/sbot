import WebSocket from 'ws';
import axios, { type AxiosInstance } from 'axios';
import {
  DEFAULT_PORT,
  WsCommandType,
  type WebChatEvent,
} from 'sbot.commons';

export type WsListener = (event: WebChatEvent) => void;

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
    const res = await this.http.get('/api/profiles');
    return res.data.data ?? res.data ?? [];
  }

  async createSessionNew(opts: { agent: string; saver: string; memories?: string[]; wikis?: string[]; name?: string; workPath?: string }): Promise<{ id: string }> {
    const res = await this.http.post('/api/settings/profiles', opts);
    return { id: res.data.data?.id ?? res.data.id };
  }

  async deleteSession(profileId: string): Promise<void> {
    await this.http.delete(`/api/profiles/${encodeURIComponent(profileId)}/history`).catch(() => {});
    await this.http.delete(`/api/settings/profiles/${encodeURIComponent(profileId)}`);
  }

  async updateSession(profileId: string, patch: Record<string, any>): Promise<void> {
    await this.http.put(`/api/settings/profiles/${encodeURIComponent(profileId)}`, patch);
  }

  // ── Messages ──

  async fetchHistory(profileId: string): Promise<any[]> {
    const res = await this.http.get(`/api/profiles/${encodeURIComponent(profileId)}/history`);
    return res.data.data ?? res.data ?? [];
  }

  async clearHistory(profileId: string): Promise<void> {
    await this.http.delete(`/api/profiles/${encodeURIComponent(profileId)}/history`);
  }

  // ── Usage ──

  async getUsage(profileId: string): Promise<any> {
    try {
      const res = await this.http.get(`/api/thread-usage?sessions=${encodeURIComponent(profileId)}`);
      return res.data.data?.[profileId] ?? null;
    } catch { return null; }
  }

  // ── Session status ──

  async getSessionStatus(profileId: string): Promise<any> {
    try {
      const res = await this.http.get(`/api/session-status?profileId=${encodeURIComponent(profileId)}`);
      return res.data ?? null;
    } catch { return null; }
  }

  // ── Filesystem ──

  async listDir(filePath: string): Promise<any> {
    const res = await this.http.get(`/api/fs/list?path=${encodeURIComponent(filePath)}`);
    return res.data.data ?? res.data;
  }

  async quickDirs(): Promise<any[]> {
    const res = await this.http.get('/api/fs/quickdirs');
    return res.data.data ?? res.data ?? [];
  }

  async listDrives(): Promise<any[]> {
    const res = await this.http.get('/api/fs/drives');
    return res.data.data ?? res.data ?? [];
  }

  async mkdir(filePath: string): Promise<{ path: string }> {
    const res = await this.http.post('/api/fs/mkdir', { path: filePath });
    return res.data.data ?? res.data ?? { path: filePath };
  }

  async listTree(filePath: string): Promise<any> {
    const res = await this.http.get('/api/fs/entry', { params: { type: 'tree', path: filePath } });
    return res.data.data ?? res.data;
  }

  async readFile(filePath: string): Promise<any> {
    const res = await this.http.get('/api/fs/entry', { params: { type: 'read', path: filePath } });
    return res.data.data ?? res.data;
  }

  async writeFile(filePath: string, content: string, expectedMtime?: number): Promise<{ path: string; size: number; mtime: number }> {
    try {
      const res = await this.http.put('/api/fs/entry', { path: filePath, content, expectedMtime });
      return res.data.data ?? res.data;
    } catch (err: any) {
      const status = err?.response?.status;
      const msg = err?.response?.data?.message ?? err?.message ?? 'writeFile failed';
      const e: any = new Error(msg);
      if (status) e.status = status;
      throw e;
    }
  }

  getRawFileUrl(filePath: string): string {
    return `${this.baseUrl}/api/fs/entry/raw?path=${encodeURIComponent(filePath)}`;
  }

  async gitStatus(root: string): Promise<any> {
    const res = await this.http.get('/api/git/status', { params: { root } });
    return res.data.data ?? res.data;
  }

  async gitDiff(root: string, filePath: string, fullContent = false): Promise<any> {
    const res = await this.http.get('/api/git/diff', { params: { root, path: filePath, full: fullContent ? '1' : undefined } });
    return res.data.data ?? res.data;
  }

  // ── Thinks ──

  async fetchThinks(url: string): Promise<any> {
    const res = await this.http.get(url);
    return res.data;
  }

  // ── WebSocket commands ──

  send(profileId: string, msg: Record<string, any>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ ...msg, profileId }));
    }
  }

  sendParts(profileId: string, parts: any[], attachments?: any[]): void {
    this.send(profileId, {
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
