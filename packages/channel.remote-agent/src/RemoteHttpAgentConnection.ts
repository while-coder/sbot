import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { ILogger } from "channel.base";
import { AgentServerMessageType, type AgentServerMessage } from "./protocol";
import { RemoteAgentConnection } from "./RemoteAgentConnection";

/** One long-lived HTTP chat response, streamed to the client as SSE. */
export class RemoteHttpAgentConnection extends RemoteAgentConnection {
  readonly requestId = randomUUID();
  private closed = false;

  constructor(private readonly response: ServerResponse, logger?: ILogger) {
    super(logger);
    response.on("close", () => {
      this.closed = true;
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
    this.failAllPending("外部客户端连接已关闭");
    this.response.end();
  }

  protected send(message: AgentServerMessage): void {
    this.response.write(`event: ${message.type}\ndata: ${JSON.stringify(message.data ?? {})}\n\n`);
    if (message.type === AgentServerMessageType.Done) this.close();
  }
}
