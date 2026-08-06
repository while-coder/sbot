/**
 * remote-agent 的线上协议，客户端视角的一份副本。
 *
 * 字段与枚举值必须和 sbot 侧的 packages/channel.remote-agent/src/protocol.ts 完全一致，
 * 改协议时两边一起改。这里不引用那个包：它依赖 channel.base 与 node 类型，而本库要在浏览器里跑。
 *
 * 分工：sbot 拥有会话、模型、历史与 agent 执行；客户端声明自己当前可用的工具、执行工具调用、
 * 回传有限长度的文本结果。sbot 不需要知道客户端是调试器、IDE 还是别的什么。
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

/** sbot 的消息角色，取自它的 MessageRole。 */
export const MessageRole = { Human: "human", AI: "ai", Tool: "tool", System: "system" } as const;

/** sbot 的 ChatMessage.status 取值；running 表示这条只是中间进展，结果还没定。 */
export const MessageStatus = { Running: "running", Success: "success", Error: "error" } as const;

/** 客户端工具的声明，inputSchema 是 JSON Schema。 */
export interface RemoteToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
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

/** 谁在用：设备级或账号级，通常整个客户端固定。 */
export interface AgentUserIdentity {
  userId: string;
  userInfo: AgentUserInfo;
}

/** 这轮打给哪个会话：sessionId 决定 sbot 那边用哪份历史与工作目录。 */
export interface AgentSessionTarget {
  sessionId: string;
  sessionInfo: AgentSessionInfo;
}

/** 身份信息属于每次 chat / abort 本身，不属于连接注册。 */
export interface AgentSessionIdentity extends AgentUserIdentity, AgentSessionTarget {}

/** 随消息一起上传的附件，name 搭配 dataUrl 或纯文本 content。 */
export interface AttachmentInput {
  name: string;
  dataUrl?: string;
  content?: string;
}

/** 与 scorpio.ai 的 MessageContent 对齐：纯文本，或多模态段落数组。 */
export type MessageContent = string | Array<Record<string, unknown>>;

/** 一轮对话的请求体，两种传输共用。 */
export interface AgentChatRequest extends AgentSessionIdentity {
  content: MessageContent;
  /** 空字符串是合法值，表示显式清空本轮的任务提示词。 */
  systemPrompt: string;
  /** 空数组是合法值，表示本轮没有客户端工具。 */
  tools: RemoteToolDefinition[];
  /** sbot 那台机器上的工作目录，只对本轮生效；留空则由 sbot 用会话默认目录。 */
  workPath?: string;
  attachments?: AttachmentInput[];
}

/** 消息流里的一次工具调用，id 是模型给的 tool_call_id，工具结果靠它对上。 */
export interface RemoteMessageToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** 要客户端执行并回传结果的工具调用，callId 由 sbot 生成，只用于回传。 */
export interface RemoteToolCall {
  callId: string;
  name: string;
  args: Record<string, unknown>;
}

/**
 * sbot 推来的一条对话消息，字段与它的 ChatMessage 一一对应，只做了扁平化：
 * ai 消息可能带 toolCalls，tool 消息是某次调用的结果（toolCallId 指回发起它的调用）。
 * sbot 自己那侧执行的工具和客户端工具在这里长得一样，客户端工具只是多了一次前端执行的往返。
 */
export interface RemoteChatMessage {
  role: string;
  content: string;
  toolCalls: RemoteMessageToolCall[];
  toolCallId: string;
  name: string;
  status: string;
}

/**
 * 服务端事件。Done 不在这里：它只表示本轮收尾，由传输层自己消化。
 * Ready 在 HTTP 上是每轮一次、在 WebSocket 上是连接建立一次，同样由传输层消化。
 */
export type AgentServerEvent =
  | { type: AgentServerMessageType.Message; message: RemoteChatMessage }
  /** content 是本轮到目前为止的完整文本，按替换处理而不是追加。 */
  | { type: AgentServerMessageType.Stream; content: string }
  | { type: AgentServerMessageType.ToolCall; toolCall: RemoteToolCall }
  | { type: AgentServerMessageType.Error; message: string };

/** 把服务端推来的原始 ChatMessage 扁平化，多模态正文只留文本段。 */
export function parseChatMessage(value: unknown): RemoteChatMessage {
  const raw = asObject(value);
  const calls = Array.isArray(raw.tool_calls) ? raw.tool_calls : [];
  return {
    role: asString(raw.role),
    content: contentText(raw.content),
    // 不按 name/id 过滤：即使上游某条调用字段不完整，也应保留一个可见条目，
    // 避免「所有工具调用」视图悄悄少一项；界面层再补默认名称和本地 id。
    toolCalls: calls.map(item => {
      const call = asObject(item);
      return { id: asString(call.id), name: asString(call.name), args: asObject(call.args) };
    }),
    toolCallId: asString(raw.tool_call_id),
    name: asString(raw.name),
    status: asString(raw.status),
  };
}

/** 多模态正文取纯文本，和 sbot 自己取文本的做法一致：图片、音频这些段落直接丢掉。 */
export function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map(part => asObject(part))
    .filter(part => part.type === "text")
    .map(part => asString(part.text))
    .filter(Boolean)
    .join("\n");
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}
