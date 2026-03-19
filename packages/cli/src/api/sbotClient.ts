import nodeHttp from 'node:http';
import readline from 'node:readline';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import axios, { type AxiosInstance } from 'axios';
import { DEFAULT_PORT, type Settings, type WebChatEvent } from 'sbot.commons';

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
    const body = JSON.stringify({ query, agentId, saveId, memoryId, workPath });
    const url = new URL(`${this.baseUrl}/api/chat`);

    const res = await new Promise<nodeHttp.IncomingMessage>((resolve, reject) => {
      const req = nodeHttp.request(
        {
          hostname: url.hostname,
          port: parseInt(url.port) || 80,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        resolve,
      );
      req.on('error', reject);
      signal.addEventListener('abort', () => req.destroy(new Error('AbortError')), { once: true });
      req.write(body);
      req.end();
    });

    if (res.statusCode !== 200) {
      throw new Error(`Chat request failed: ${res.statusCode}`);
    }

    const rl = readline.createInterface({ input: res, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.startsWith('data: ')) continue;
      try {
        const event = JSON.parse(line.slice(6)) as WebChatEvent;
        yield event;
        if (event.type === 'done') return;
      } catch {
        // skip malformed JSON
      }
    }
  }
}
