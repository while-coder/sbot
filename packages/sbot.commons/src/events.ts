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

/** Multimodal message content: plain string or array of content parts (text/image_url/etc.) */
export type DisplayContent = string | any[]

export enum AskQuestionType {
  Radio    = 'radio',
  Checkbox = 'checkbox',
  Input    = 'input',
}

export type AskQuestionSpec =
  | { type: AskQuestionType.Radio;    label: string; options: string[]; allowCustom?: boolean }
  | { type: AskQuestionType.Checkbox; label: string; options: string[]; allowCustom?: boolean }
  | { type: AskQuestionType.Input;    label: string; placeholder?: string }

export interface HumanData    { content: DisplayContent }
export interface StreamData   { content: DisplayContent }
export interface MessageData  { message: ChatMessage; thinkId?: string; createdAt: number }
export interface ToolCallData { approvalId: string; toolCallId?: string; name: string; args: Record<string, any> }
export interface AskData      { id: string; title?: string; questions: AskQuestionSpec[] }
export interface DoneData     { pendingMessages?: DisplayContent[] }
export interface ErrorData    { message: string }
export interface QueueData    { pendingMessages: DisplayContent[] }

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
