import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { ILogger } from "channel.base";
import { AgentServerMessageType, type AgentServerMessage } from "./protocol";
import { RemoteAgentConnection } from "./RemoteAgentConnection";

/**
 * 一轮 chat 允许多久没有任何事件。会话把消息投进队列就返回，正常收尾靠 done 事件；
 * 消息被意图过滤或消息合并吞掉时永远等不到 done，没有兜底连接会一直挂着，客户端也一直在等。
 */
const IDLE_TIMEOUT_MS = 30 * 60_000;

/** One long-lived HTTP chat response, streamed to the client as SSE. */
export class RemoteHttpAgentConnection extends RemoteAgentConnection {
  readonly requestId = randomUUID();
  private closed = false;
  private idleTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly response: ServerResponse, logger?: ILogger) {
    super(logger);
    response.on("close", () => {
      this.closed = true;
      clearTimeout(this.idleTimer);
      this.failAllPending("外部客户端连接已关闭");
    });
  }

  get alive(): boolean {
    return !this.closed && !this.response.writableEnded;
  }

  open(): void {
    this.response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
    });
    this.emit(AgentServerMessageType.Ready, { requestId: this.requestId });
  }

  close(): void {
    if (!this.alive) return;
    this.closed = true;
    clearTimeout(this.idleTimer);
    this.failAllPending("外部客户端连接已关闭");
    this.response.end();
  }

  protected send(message: AgentServerMessage): void {
    this.response.write(`event: ${message.type}\ndata: ${JSON.stringify(message.data ?? {})}\n\n`);
    // done 和 error 都算本轮收尾：请求校验失败只发 error，没有后续的 done。
    if (message.type === AgentServerMessageType.Done || message.type === AgentServerMessageType.Error) {
      return this.close();
    }
    this.resetIdleTimer();
  }

  /** 每发出一个事件就重新计时；超时说明本轮已经没人推进了，给客户端一个 error 再收尾。 */
  private resetIdleTimer(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.logger?.warn(`Remote-agent HTTP chat idle for ${IDLE_TIMEOUT_MS / 60_000} minutes, closing requestId=${this.requestId}`);
      this.emit(AgentServerMessageType.Error, { message: "本轮处理长时间没有进展，连接已关闭" });
    }, IDLE_TIMEOUT_MS);
  }
}
