import type { AgentChatRequest, AgentServerEvent, AgentSessionIdentity } from "./protocol.js";

/**
 * 一次一轮：sbot 侧的每轮对话都以 done（校验失败时是 error）收尾，
 * chat() 在本轮收尾后才 resolve，新一轮开始前会先收掉上一轮。
 */
export interface RemoteAgentTransport {
  /** 发起一轮对话，直到本轮收尾才 resolve；连接层失败才 reject，服务端 error 事件走 onEvent。 */
  chat(request: AgentChatRequest): Promise<void>;
  /** 回传工具执行结果；本轮已结束时静默丢弃，避免停止后还去打服务端。 */
  sendToolResult(callId: string, output: string, isError: boolean): Promise<void>;
  /** 请求 sbot 停掉本轮 agent，并让本地的 chat() 尽快收尾。 */
  abort(identity: AgentSessionIdentity): Promise<void>;
  close(): void;
}

export type AgentTransportKind = "http" | "websocket";

/** 只用得到 readyState / send / close / addEventListener，浏览器的 WebSocket 和 node 的 ws 都满足。 */
export interface AgentWebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  // 事件对象在浏览器和 ws 之间形状不同（ws 的 message.data 可能是 Buffer），这里只按结构取用。
  addEventListener(type: string, listener: (event: any) => void): void;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface TransportOptions {
  /** HTTP 传输用 http(s):// 根地址（可带路径前缀），WebSocket 传输用 ws(s):// 地址。 */
  url: string;
  /** channel 配置里的 accessToken。 */
  token: string;
  onEvent: (event: AgentServerEvent) => void;
  /** 省略时按 url 协议推断。 */
  transport?: AgentTransportKind;
  /** 自定义 fetch（走代理、加鉴权、测试替身），默认用全局 fetch。 */
  fetch?: FetchLike;
  /** 自定义 WebSocket 构造（Node 22 以下需要传 ws 包），默认用全局 WebSocket。 */
  webSocketFactory?: (url: string) => AgentWebSocketLike;
}

export function transportKind(options: TransportOptions): AgentTransportKind {
  if (options.transport) return options.transport;
  const protocol = protocolOf(options.url);
  return protocol === "ws:" || protocol === "wss:" ? "websocket" : "http";
}

function protocolOf(value: string): string {
  try {
    return new URL(value.trim()).protocol;
  } catch {
    return "";
  }
}

/** fetch 的连接失败是 TypeError，原始文案（"Failed to fetch"）对用户没有意义，包一层。 */
export function asError(value: unknown): Error {
  if (value instanceof Error) return value instanceof TypeError ? new Error(`无法连接 sbot：${value.message}`) : value;
  return new Error(String(value));
}
