import {
  AgentClientMessageType,
  AgentServerMessageType,
  asObject,
  asString,
  parseChatMessage,
  parseJson,
  type AgentChatRequest,
  type AgentSessionIdentity,
} from "./protocol.js";
import { asError, type AgentWebSocketLike, type RemoteAgentTransport, type TransportOptions } from "./transport.js";
import { normalizeSocketUrl } from "./utils.js";

const OPEN = 1;

interface AgentRun {
  /** chat() 的 promise，本轮收尾时 resolve、连接断掉时 reject。 */
  finish: () => void;
  fail: (error: Error) => void;
}

/**
 * WebSocket 传输：一条长连接先 register，随后每轮 chat 复用它，工具结果与中止都发在同一条连接上。
 * 与 HTTP 传输的差异（没有 requestId、ready 是连接级而不是每轮一次）在这里吸收，上层看到的事件流一致。
 */
export class WsAgentTransport implements RemoteAgentTransport {
  private readonly url: string;
  private readonly token: string;
  private readonly onEvent: TransportOptions["onEvent"];
  private readonly factory: (url: string) => AgentWebSocketLike;
  private socket?: AgentWebSocketLike;
  /** 建连（含 register 到 ready）只进行一次，并发的 chat 共用同一个 promise。 */
  private connecting?: Promise<AgentWebSocketLike>;
  private run?: AgentRun;

  constructor(options: TransportOptions) {
    this.url = normalizeSocketUrl(options.url);
    this.token = options.token;
    this.onEvent = options.onEvent;
    this.factory = options.webSocketFactory ?? defaultFactory();
  }

  async chat(request: AgentChatRequest): Promise<void> {
    // 上一轮还没收尾就直接开新一轮时，先把它按中止处理，语义和 HTTP 传输一致。
    this.settleRun();
    const socket = await this.connect();
    return new Promise<void>((resolve, reject) => {
      this.run = { finish: resolve, fail: reject };
      try {
        this.send(socket, { type: AgentClientMessageType.Chat, ...request });
      } catch (error) {
        this.run = undefined;
        reject(asError(error));
      }
    });
  }

  async sendToolResult(callId: string, output: string, isError: boolean): Promise<void> {
    const socket = this.socket;
    if (!this.run || !socket || socket.readyState !== OPEN) return;
    this.send(socket, { type: AgentClientMessageType.ToolResult, callId, output, isError });
  }

  /**
   * 请求 sbot 停掉本轮 agent 后立刻在本地收尾：连接是复用的，不能像 HTTP 那样靠关流来结束等待，
   * 而服务端为这一轮补发的 done / error 已经没有意义（run 置空后会被丢弃）。
   */
  async abort(identity: AgentSessionIdentity): Promise<void> {
    const socket = this.socket;
    if (!this.run) return;
    if (socket && socket.readyState === OPEN) {
      this.send(socket, { type: AgentClientMessageType.Abort, ...identity });
    }
    this.settleRun();
  }

  close(): void {
    this.settleRun();
    const socket = this.socket;
    this.socket = undefined;
    this.connecting = undefined;
    socket?.close();
  }

  private connect(): Promise<AgentWebSocketLike> {
    const socket = this.socket;
    if (socket && socket.readyState === OPEN) return Promise.resolve(socket);
    // 连接断了就重建：上一条 socket 的事件监听随它一起作废。
    this.connecting ??= this.open().finally(() => { this.connecting = undefined; });
    return this.connecting;
  }

  /** 建连并完成 register：令牌不对时服务端直接关连接（1008），所以要等到 ready 才算连上。 */
  private open(): Promise<AgentWebSocketLike> {
    return new Promise<AgentWebSocketLike>((resolve, reject) => {
      let socket: AgentWebSocketLike;
      try {
        socket = this.factory(this.url);
      } catch (error) {
        return reject(asError(error));
      }
      let ready = false;
      socket.addEventListener("open", () => {
        this.send(socket, { type: AgentClientMessageType.Register, token: this.token });
      });
      socket.addEventListener("message", event => {
        const message = asObject(parseJson(text(event?.data)));
        if (!ready) {
          if (message.type !== AgentServerMessageType.Ready) return;
          ready = true;
          this.socket = socket;
          resolve(socket);
          return;
        }
        this.dispatch(message);
      });
      socket.addEventListener("error", () => {
        // error 事件不带可用信息，具体原因（拒绝令牌、地址不通）都要看随后的 close。
        if (!ready) reject(new Error(`无法连接 sbot：${this.url}`));
      });
      socket.addEventListener("close", event => {
        if (this.socket === socket) this.socket = undefined;
        if (!ready) return reject(new Error(closeReason(event, this.url)));
        this.failRun(new Error("sbot 连接已断开"));
      });
    });
  }

  private dispatch(message: Record<string, unknown>): void {
    const run = this.run;
    // 已中止或本轮已收尾后补来的事件直接丢掉，免得界面在「已停止」之后又冒出内容。
    if (!run) return;
    const data = asObject(message.data);
    if (message.type === AgentServerMessageType.Stream) {
      this.onEvent({ type: AgentServerMessageType.Stream, content: asString(data.content) });
    } else if (message.type === AgentServerMessageType.Message) {
      this.onEvent({ type: AgentServerMessageType.Message, message: parseChatMessage(data.message) });
    } else if (message.type === AgentServerMessageType.ToolCall) {
      this.onEvent({
        type: AgentServerMessageType.ToolCall,
        toolCall: { callId: asString(data.callId), name: asString(data.name), args: asObject(data.args) },
      });
    } else if (message.type === AgentServerMessageType.Error) {
      this.onEvent({ type: AgentServerMessageType.Error, message: asString(data.message) || "sbot 请求失败" });
      // error 就是本轮的收尾（请求校验失败时没有后续的 done）。
      this.settleRun();
    } else if (message.type === AgentServerMessageType.Done) {
      this.settleRun();
    }
  }

  /** 正常收尾：本轮的 chat() resolve。 */
  private settleRun(): void {
    const run = this.run;
    if (!run) return;
    this.run = undefined;
    run.finish();
  }

  /** 连接在本轮进行中断掉：结果永远不会再来了，让 chat() 以错误收尾。 */
  private failRun(error: Error): void {
    const run = this.run;
    if (!run) return;
    this.run = undefined;
    run.fail(error);
  }

  private send(socket: AgentWebSocketLike, message: Record<string, unknown>): void {
    socket.send(JSON.stringify(message));
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

/** 服务端拒绝注册时把原因写在 close 帧里（如 invalid token），原样带给用户。 */
function closeReason(event: unknown, url: string): string {
  const detail = asObject(event);
  const reason = asString(detail.reason).trim();
  if (reason) return `sbot 拒绝了连接：${reason}`;
  return `无法连接 sbot：${url}`;
}

function defaultFactory(): (url: string) => AgentWebSocketLike {
  if (typeof WebSocket !== "function") {
    throw new Error("当前环境没有全局 WebSocket，请通过 webSocketFactory 选项传入实现（如 ws 包）");
  }
  return url => new WebSocket(url);
}
