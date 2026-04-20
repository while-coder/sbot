import type { SbotClient } from '../api/sbotClient.js';
import type { HistoryItem, PendingApproval, PendingAsk } from '../ui/types.js';
import { StreamingState } from '../ui/types.js';

export interface AppState {
  connection: { baseUrl: string; workPath: string } | null;
  sessionId: string | null;
  agentName: string;
  saverName: string;

  history: HistoryItem[];
  pendingContent: string;
  streamingState: StreamingState;
  pendingApproval: PendingApproval | null;
  pendingAsk: PendingAsk | null;

  toolCallsExpanded: boolean;
  inputHistory: string[];

  commandMode: boolean;
}

const INITIAL_STATE: AppState = {
  connection: null,
  sessionId: null,
  agentName: '',
  saverName: '',
  history: [],
  pendingContent: '',
  streamingState: StreamingState.Idle,
  pendingApproval: null,
  pendingAsk: null,
  toolCallsExpanded: false,
  inputHistory: [],
  commandMode: false,
};

export class AppStateStore {
  private state: AppState;
  private listeners = new Set<(state: AppState) => void>();
  client: SbotClient | null = null;

  constructor() {
    this.state = { ...INITIAL_STATE };
  }

  setClient(client: SbotClient): void {
    this.client = client;
  }

  getState(): AppState {
    return this.state;
  }

  setState(partial: Partial<AppState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  subscribe(listener: (state: AppState) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  clearHistory(): void {
    this.setState({ history: [], pendingContent: '' });
  }

  appendHistory(item: HistoryItem): void {
    this.setState({ history: [...this.state.history, item] });
  }

  addInputHistory(input: string): void {
    this.setState({ inputHistory: [...this.state.inputHistory, input] });
  }
}
