/** Client → Server WS message types */
export enum WsCommandType {
  Query    = 'query',
  Approval = 'approval',
  Ask      = 'ask',
  Abort    = 'abort',
}

/** Server → Client WS event types */
export enum WebChatEventType {
  Human    = 'human',
  Stream   = 'stream',
  Message  = 'message',
  ToolCall = 'tool_call',
  Ask      = 'ask',
  Done     = 'done',
  Error    = 'error',
}

type AskQuestionSpec =
  | { type: 'radio';    label: string; options: string[]; allowCustom?: boolean }
  | { type: 'checkbox'; label: string; options: string[]; allowCustom?: boolean }
  | { type: 'input';    label: string; placeholder?: string }

export interface HumanEvent    { type: WebChatEventType.Human;    content: string }
export interface StreamEvent   { type: WebChatEventType.Stream;   content: string }
export interface MessageEvent  { type: WebChatEventType.Message;  role: string; content?: string; tool_calls?: any[]; tool_call_id?: string }
export interface ToolCallEvent { type: WebChatEventType.ToolCall; id: string; threadId: string; name: string; args: Record<string, any> }
export interface AskEvent      { type: WebChatEventType.Ask;      id: string; threadId: string; title?: string; questions: AskQuestionSpec[] }
export interface DoneEvent     { type: WebChatEventType.Done }
export interface ErrorEvent    { type: WebChatEventType.Error;    message: string }

export type WebChatEvent =
  | HumanEvent
  | StreamEvent
  | MessageEvent
  | ToolCallEvent
  | AskEvent
  | DoneEvent
  | ErrorEvent
