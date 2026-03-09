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

  constructor(baseUrl: string) {
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
    const res = await this.http.post('/api/chat', { query, agentId, saveId, memoryId, workPath }, {
      responseType: 'stream',
      signal,
    });

    let buffer = '';
    for await (const chunk of res.data as AsyncIterable<Buffer>) {
      buffer += chunk.toString();

      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';

      for (const part of parts) {
        const dataLine = part.split('\n').find((l) => l.startsWith('data: '));
        if (!dataLine) continue;
        try {
          const event = JSON.parse(dataLine.slice(6)) as ChatEvent;
          yield event;
          if (event.type === 'done') return;
        } catch {
          // skip malformed JSON
        }
      }
    }
  }
}
