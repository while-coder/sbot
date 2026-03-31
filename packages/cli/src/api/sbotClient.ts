import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import WebSocket from 'ws';
import axios, { type AxiosInstance } from 'axios';
import { DEFAULT_PORT, WsCommandType, dirThreadId, type Settings, type WebChatEvent } from 'sbot.commons';

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

  async *chatStream(
    query: string,
    agentId: string,
    saveId: string,
    memoryId: string | null,
    signal: AbortSignal,
  ): AsyncGenerator<WebChatEvent> {
    const workPath = process.cwd();
    const threadId = dirThreadId(workPath);
    const wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/ws/chat';

    const ws = new WebSocket(wsUrl);
    const events: WebChatEvent[] = [];
    let resolve: (() => void) | null = null;
    let done = false;
    let error: Error | null = null;

    ws.on('message', (data) => {
      try {
        const event = JSON.parse(data.toString()) as WebChatEvent & { threadId?: string };
        if (event.threadId && event.threadId !== threadId) return;
        events.push(event);
        resolve?.();
      } catch { /* skip malformed */ }
    });

    ws.on('error', (err) => { error = err as Error; resolve?.(); });
    ws.on('close', () => { done = true; resolve?.(); });

    signal.addEventListener('abort', () => {
      ws.close();
      error = new Error('AbortError');
      (error as any).name = 'AbortError';
      resolve?.();
    }, { once: true });

    // wait for connection
    await new Promise<void>((r, reject) => {
      ws.on('open', r);
      ws.on('error', reject);
    });

    // send query
    ws.send(JSON.stringify({ type: WsCommandType.Query, query, threadId, workPath }));

    try {
      while (true) {
        if (events.length === 0 && !done && !error) {
          await new Promise<void>((r) => { resolve = r; });
          resolve = null;
        }
        if (error) throw error;
        while (events.length > 0) {
          const event = events.shift()!;
          yield event;
          if (event.type === 'done') return;
        }
        if (done) return;
      }
    } finally {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    }
  }
}
