import WebSocket from 'ws';
import axios, { type AxiosInstance } from 'axios';
import {
  DEFAULT_PORT,
  WsCommandType,
  type WebChatEvent,
} from 'sbot.commons';

export type WsListener = (event: WebChatEvent) => void;
export type VscodeUploadFilePayload = { name: string; type?: string; size?: number; dataUrl: string };
type UploadFileOptions = { overwrite?: boolean };

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

function escapeMultipartHeader(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r|\n/g, ' ');
}

function decodeDataUrl(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(',');
  if (comma < 0 || !/;base64/i.test(dataUrl.slice(0, comma))) {
    throw new Error('Invalid upload payload');
  }
  return Buffer.from(dataUrl.slice(comma + 1), 'base64');
}

function buildMultipartUploadBody(
  parentDir: string,
  file: VscodeUploadFilePayload,
  opts: UploadFileOptions,
): { body: Buffer; boundary: string } {
  const boundary = `----sbot-vscode-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  const append = (text: string) => chunks.push(Buffer.from(text, 'utf-8'));
  const appendField = (name: string, value: string) => {
    append(`--${boundary}\r\n`);
    append(`Content-Disposition: form-data; name="${escapeMultipartHeader(name)}"\r\n\r\n`);
    append(`${value}\r\n`);
  };

  appendField('dir', parentDir);
  if (opts.overwrite) appendField('overwrite', '1');

  const data = decodeDataUrl(file.dataUrl);
  append(`--${boundary}\r\n`);
  append(
    `Content-Disposition: form-data; name="file"; filename="${escapeMultipartHeader(file.name)}"\r\n` +
    `Content-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`,
  );
  chunks.push(data);
  append('\r\n');
  append(`--${boundary}--\r\n`);

  return { body: Buffer.concat(chunks), boundary };
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

  async deleteEntry(filePath: string): Promise<{ path: string }> {
    const res = await this.http.delete('/api/fs/entry', { params: { path: filePath } });
    return res.data.data ?? res.data ?? { path: filePath };
  }

  async uploadFile(parentDir: string, file: VscodeUploadFilePayload, opts: UploadFileOptions = {}): Promise<{ path: string; size: number }> {
    try {
      const { body, boundary } = buildMultipartUploadBody(parentDir, file, opts);
      const res = await this.http.post('/api/fs/upload', body, {
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
      });
      return res.data.data ?? res.data;
    } catch (err: any) {
      const status = err?.response?.status;
      const msg = err?.response?.data?.message ?? err?.message ?? 'uploadFile failed';
      const e: any = new Error(msg);
      if (status) e.status = status;
      throw e;
    }
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

  /**
   * Stream a file's raw bytes from the server straight to disk (no full-file buffering),
   * reporting progress as bytes arrive. Writes to a `.part` temp file and renames on
   * success; the partial file is removed on error/cancel so a failed download never
   * clobbers an existing target.
   */
  async downloadToFile(
    filePath: string,
    destPath: string,
    opts: { signal?: AbortSignal; onProgress?: (loaded: number, total: number) => void } = {},
  ): Promise<void> {
    const fs = require('node:fs') as typeof import('node:fs');
    const res = await this.http.get('/api/fs/entry/raw', {
      params: { path: filePath },
      responseType: 'stream',
      signal: opts.signal,
    });
    const total = Number(res.headers['content-length'] ?? 0);
    const stream = res.data as NodeJS.ReadableStream;
    const tmpPath = `${destPath}.part`;
    const out = fs.createWriteStream(tmpPath);
    let loaded = 0;

    try {
      await new Promise<void>((resolve, reject) => {
        stream.on('data', (chunk: Buffer) => {
          loaded += chunk.length;
          opts.onProgress?.(loaded, total);
        });
        stream.on('error', reject);
        out.on('error', reject);
        out.on('finish', resolve);
        stream.pipe(out);
      });
      await fs.promises.rename(tmpPath, destPath);
    } catch (err) {
      try { out.destroy(); } catch { /* ignore */ }
      await fs.promises.unlink(tmpPath).catch(() => {});
      throw err;
    }
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

  // ── Pty (terminal) ──

  async listShells(): Promise<any[]> {
    const res = await this.http.get('/api/pty/shells');
    return res.data.data ?? res.data ?? [];
  }

  /** Open a fresh WebSocket bound to a single pty session. Caller owns its lifecycle. */
  openPtySocket(): WebSocket {
    const url = this.baseUrl.replace(/^http/, 'ws') + '/ws/pty';
    return new WebSocket(url);
  }

  // ── WebSocket commands ──

  send(profileId: string, msg: Record<string, any>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ ...msg, profileId }));
    }
  }

  sendParts(profileId: string, parts: any[], attachments?: any[], workPath?: string): void {
    this.send(profileId, {
      type: WsCommandType.Query,
      parts,
      attachments: attachments?.length ? attachments : undefined,
      ...(workPath ? { workPath } : {}),
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
