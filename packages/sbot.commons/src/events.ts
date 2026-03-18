export enum WebChatEventType {
  Human    = 'human',
  Stream   = 'stream',
  Message  = 'message',
  ToolCall = 'tool_call',
  Done     = 'done',
  Error    = 'error',
}

export interface HumanEvent    { type: WebChatEventType.Human;    content: string }
export interface StreamEvent   { type: WebChatEventType.Stream;   content: string }
export interface MessageEvent  { type: WebChatEventType.Message;  role: string; content?: string; tool_calls?: any[]; tool_call_id?: string }
export interface ToolCallEvent { type: WebChatEventType.ToolCall; id: string; name: string; args: Record<string, any> }
export interface DoneEvent     { type: WebChatEventType.Done }
export interface ErrorEvent    { type: WebChatEventType.Error;    message: string }

export type WebChatEvent =
  | HumanEvent
  | StreamEvent
  | MessageEvent
  | ToolCallEvent
  | DoneEvent
  | ErrorEvent
