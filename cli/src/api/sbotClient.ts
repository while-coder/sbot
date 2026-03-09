export interface AgentConfig {
  name: string;
  [key: string]: unknown;
}

export interface SaverConfig {
  name: string;
  [key: string]: unknown;
}

export interface MemoryConfig {
  name: string;
  [key: string]: unknown;
}

export interface SbotSettings {
  agents: AgentConfig[];
  savers: SaverConfig[];
  memories: MemoryConfig[];
  sessions: Array<{ name: string; [key: string]: unknown }>;
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
  constructor(private readonly baseUrl: string) {}

  async isOnline(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/settings`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async fetchSettings(): Promise<SbotSettings> {
    const res = await fetch(`${this.baseUrl}/api/settings`);
    if (!res.ok) throw new Error(`Failed to fetch settings: ${res.status}`);
    return res.json() as Promise<SbotSettings>;
  }

  async createSession(
    name: string,
    agentName: string,
    saverName: string,
    memoryName: string | null,
  ): Promise<void> {
    const body: Record<string, unknown> = { name, agentName, saverName };
    if (memoryName !== null) body.memoryName = memoryName;
    const res = await fetch(`${this.baseUrl}/api/settings/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to create session: ${res.status} ${text}`);
    }
  }

  async *chatStream(
    query: string,
    sessionId: string,
    signal: AbortSignal,
  ): AsyncGenerator<ChatEvent> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, sessionId }),
      signal,
    });
    if (!res.ok) throw new Error(`Chat request failed: ${res.status}`);
    if (!res.body) throw new Error('No response body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';

        for (const chunk of chunks) {
          const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '));
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
      // Flush any remaining bytes in the decoder
      const remaining = decoder.decode();
      if (remaining) buffer += remaining;
    } finally {
      reader.releaseLock();
    }
  }
}
