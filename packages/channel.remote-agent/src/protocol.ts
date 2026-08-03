/**
 * External agent client <-> sbot protocol.
 *
 * sbot owns the agent session and model configuration. The frontend declares
 * its currently available local capabilities, executes tool calls, and returns
 * bounded text results. The client may represent a debugger, an IDE, or any
 * other product-specific tool surface; sbot does not need to know which.
 */

export enum AgentClientMessageType {
  Register = "register",
  Chat = "chat",
  ToolResult = "toolResult",
  Abort = "abort",
}

export enum AgentServerMessageType {
  Ready = "ready",
  Message = "message",
  Stream = "stream",
  ToolCall = "toolCall",
  Done = "done",
  Error = "error",
}

import type { AttachmentInput, MessageContent } from "channel.base";

export interface RemoteToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface AgentRegisterMessage {
  type: AgentClientMessageType.Register;
  token: string;
}

export interface AgentUserInfo {
  name?: string;
  avatar?: string;
  [key: string]: unknown;
}

export interface AgentSessionInfo {
  name?: string;
  avatar?: string;
  [key: string]: unknown;
}

export interface AgentSessionIdentity {
  /** All identity data belongs to the actual chat/action, never registration. */
  userId: string;
  userInfo: AgentUserInfo;
  sessionId: string;
  sessionInfo: AgentSessionInfo;
}

export interface AgentChatMessage extends AgentSessionIdentity {
  type: AgentClientMessageType.Chat;
  /** Standard scorpio.ai multimodal input. */
  content: MessageContent;
  /** Additional image or file attachments, equivalent to the web channel's attachments. */
  attachments?: AttachmentInput[];
  /** An empty string explicitly clears the task-specific prompt. */
  systemPrompt: string;
  /** An empty list explicitly declares that this chat has no client tools. */
  tools: RemoteToolDefinition[];
}

export interface AgentToolResultMessage {
  type: AgentClientMessageType.ToolResult;
  callId: string;
  output: string;
  isError?: boolean;
}

export interface AgentAbortMessage extends AgentSessionIdentity {
  type: AgentClientMessageType.Abort;
}

export type AgentClientMessage =
  | AgentRegisterMessage
  | AgentChatMessage
  | AgentToolResultMessage
  | AgentAbortMessage;

export interface AgentServerMessage {
  type: AgentServerMessageType;
  data?: Record<string, unknown>;
}
