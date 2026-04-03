import type { ChatMessage } from './api'

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

export enum AskQuestionType {
  Radio    = 'radio',
  Checkbox = 'checkbox',
  Input    = 'input',
}

export type AskQuestionSpec =
  | { type: AskQuestionType.Radio;    label: string; options: string[]; allowCustom?: boolean }
  | { type: AskQuestionType.Checkbox; label: string; options: string[]; allowCustom?: boolean }
  | { type: AskQuestionType.Input;    label: string; placeholder?: string }

export interface HumanData    { content: string }
export interface StreamData   { content: string | any[] }
export interface MessageData  { message: ChatMessage; thinkId?: string; createdAt: number }
export interface ToolCallData { approvalId: string; toolCallId?: string; name: string; args: Record<string, any> }
export interface AskData      { id: string; title?: string; questions: AskQuestionSpec[] }
export interface DoneData     { pendingMessages?: string[] }
export interface ErrorData    { message: string }
export interface QueueData    { pendingMessages: string[] }

export type WebChatEventDataMap = {
  [WebChatEventType.Human]:    HumanData
  [WebChatEventType.Stream]:   StreamData
  [WebChatEventType.Message]:  MessageData
  [WebChatEventType.ToolCall]: ToolCallData
  [WebChatEventType.Ask]:      AskData
  [WebChatEventType.Done]:     DoneData
  [WebChatEventType.Error]:    ErrorData
  [WebChatEventType.Queue]:    QueueData
}

export type WebChatEvent<T extends WebChatEventType = WebChatEventType> = {
  sessionId: string
  type: T
  data: WebChatEventDataMap[T]
}
