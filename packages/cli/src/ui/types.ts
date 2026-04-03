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
  type: 'toolCall';
  id: string;
  toolCallId: string;
  name: string;
  args: unknown;
  result?: string;
}

export interface ErrorMessage {
  type: 'error';
  id: string;
  message: string;
}

export interface AskHistoryMessage {
  type: 'ask';
  id: string;
  title?: string;
  answers: Record<string, string | string[]>;
}

export type HistoryItem =
  | UserMessage
  | AssistantMessage
  | ToolCallMessage
  | ErrorMessage
  | AskHistoryMessage;

export enum AppState {
  Loading = 'loading',
  Setup = 'setup',
  Chat = 'chat',
}

export enum StreamingState {
  Idle = 'idle',
  Responding = 'responding',
  Approval = 'approval',
  Asking = 'asking',
}

export interface PendingApproval {
  id: string;
  name: string;
  args: Record<string, any>;
}

export interface PendingAsk {
  id: string;
  title?: string;
  questions: AskQuestionSpec[];
}

export type AskQuestionSpec =
  | { type: 'radio';    label: string; options: string[]; allowCustom?: boolean }
  | { type: 'checkbox'; label: string; options: string[]; allowCustom?: boolean }
  | { type: 'input';    label: string; placeholder?: string }
