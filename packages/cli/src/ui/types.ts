export interface UserMessage {
  type: 'user';
  id: string;
  content: string;
}

export interface AssistantMessage {
  type: 'assistant';
  id: string;
  content: string;
}

export interface ToolCallMessage {
  type: 'tool_call';
  id: string;
  name: string;
  args: unknown;
}

export interface ErrorMessage {
  type: 'error';
  id: string;
  message: string;
}

export type HistoryItem =
  | UserMessage
  | AssistantMessage
  | ToolCallMessage
  | ErrorMessage;

export enum AppState {
  Loading = 'loading',
  Setup = 'setup',
  Chat = 'chat',
}

export enum StreamingState {
  Idle = 'idle',
  Responding = 'responding',
}
