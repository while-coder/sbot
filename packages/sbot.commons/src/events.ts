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
  ToolCall = 'toolCall',
  Ask      = 'ask',
  Done     = 'done',
  Error    = 'error',
  Queue    = 'queue',
}

type AskQuestionSpec =
  | { type: 'radio';    label: string; options: string[]; allowCustom?: boolean }
  | { type: 'checkbox'; label: string; options: string[]; allowCustom?: boolean }
  | { type: 'input';    label: string; placeholder?: string }

export interface HumanEvent    { type: WebChatEventType.Human;    content: string }
export interface StreamEvent   { type: WebChatEventType.Stream;   content: string | any[] }
export interface MessageEvent  { type: WebChatEventType.Message;  role: string; content?: string | any[]; tool_calls?: any[]; tool_call_id?: string; thinkId?: string }
export interface ToolCallEvent { type: WebChatEventType.ToolCall; id: string; name: string; args: Record<string, any> }
export interface AskEvent      { type: WebChatEventType.Ask;      id: string; title?: string; questions: AskQuestionSpec[] }
export interface DoneEvent     { type: WebChatEventType.Done;    pendingMessages?: string[] }
export interface ErrorEvent    { type: WebChatEventType.Error;    message: string }
export interface QueueEvent    { type: WebChatEventType.Queue;   pendingMessages: string[] }

export type WebChatEvent =
  | HumanEvent
  | StreamEvent
  | MessageEvent
  | ToolCallEvent
  | AskEvent
  | DoneEvent
  | ErrorEvent
  | QueueEvent
