import { WebSocket } from "ws";
import type { ILogger } from "channel.base";
import { type AgentServerMessage } from "./protocol";
import { RemoteAgentConnection } from "./RemoteAgentConnection";

export class RemoteWSAgentConnection extends RemoteAgentConnection {
  constructor(private readonly socket: WebSocket, logger?: ILogger) {
    super(logger);
  }

  get alive(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  close(): void {
    this.failAllPending("外部客户端连接已关闭");
    try { this.socket.close(); } catch { /* already closed */ }
  }

  protected send(message: AgentServerMessage): void {
    this.socket.send(JSON.stringify(message));
  }
}
