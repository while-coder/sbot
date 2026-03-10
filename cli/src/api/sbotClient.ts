import nodeHttp from 'node:http';
import readline from 'node:readline';
import axios, { type AxiosInstance } from 'axios';

export interface SbotSettings {
  agents?: Record<string, { name?: string }>;
  savers?: Record<string, { name?: string }>;
  memories?: Record<string, { name?: string }>;
}

export interface ChatEvent {
  type: 'stream' | 'message' | 'tool_call' | 'error' | 'done';
  content?: string;
  role?: string;
  tool_calls?: unknown[];
  name?: string;
  args?: unknown;
  message?: string;
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
  ): AsyncGenerator<ChatEvent> {
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
        const event = JSON.parse(line.slice(6)) as ChatEvent;
        yield event;
        if (event.type === 'done') return;
      } catch {
        // skip malformed JSON
      }
    }
  }
}
