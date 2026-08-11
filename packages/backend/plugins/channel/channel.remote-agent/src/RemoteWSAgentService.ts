import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { ILogger } from "channel.base";
import { RemoteWSAgentConnection } from "./RemoteWSAgentConnection";
import { RemoteAgentService, type RemoteAgentServiceOptions } from "./RemoteAgentService";
import {
  AgentClientMessageType,
  AgentServerMessageType,
  type AgentClientMessage,
  type AgentRegisterMessage,
} from "./protocol";

export interface RemoteWSAgentServiceOptions extends RemoteAgentServiceOptions {
  port: number;
  host?: string;
}

/** WebSocket transport for remote-agent clients. */
export class RemoteWSAgentService extends RemoteAgentService {
  private readonly connections = new Set<RemoteWSAgentConnection>();
  private readonly socketConnections = new WeakMap<WebSocket, RemoteWSAgentConnection>();
  private server?: WebSocketServer;

  constructor(private readonly wsOptions: RemoteWSAgentServiceOptions) {
    super(wsOptions);
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = this.server = new WebSocketServer({ host: this.wsOptions.host, port: this.wsOptions.port });
    await new Promise<void>((resolve, reject) => {
      const listening = (): void => { server.off("error", startupError); resolve(); };
      const startupError = (error: Error): void => { server.off("listening", listening); reject(error); };
      server.once("listening", listening);
      server.once("error", startupError);
    });
    server.on("error", error => this.wsOptions.logger?.error(`Remote-agent WebSocket server error: ${error.message}`));
    server.on("connection", socket => this.accept(socket));
    this.wsOptions.logger?.info(`Remote-agent WebSocket listening on ws://${this.wsOptions.host || "0.0.0.0"}:${this.wsOptions.port}`);
  }

  dispose(): void {
    for (const connection of this.connections) connection.close();
    this.connections.clear();
    this.server?.close();
    this.server = undefined;
  }

  private accept(socket: WebSocket): void {
    socket.on("message", raw => {
      void this.onMessage(socket, raw).catch(error => {
        this.wsOptions.logger?.warn(`Remote-agent WebSocket message failed: ${error instanceof Error ? error.message : String(error)}`);
        this.sendSocketError(socket, "请求处理失败");
      });
    });
    socket.on("error", error => this.wsOptions.logger?.warn(`Remote-agent WebSocket client error: ${error.message}`));
    socket.on("close", () => {
      const connection = this.socketConnections.get(socket);
      if (!connection) return;
      connection.failAllPending("外部客户端连接已关闭");
      this.connections.delete(connection);
    });
  }

  private async onMessage(socket: WebSocket, raw: RawData): Promise<void> {
    const message = parseMessage(raw);
    const connection = this.socketConnections.get(socket);
    if (!message) {
      if (connection) this.sendError(connection, "无效的客户端消息");
      else this.sendSocketError(socket, "无效的客户端消息");
      return;
    }
    if (!connection) {
      if (message.type !== AgentClientMessageType.Register) return void socket.close(1008, "register required");
      this.handleRegister(socket, message);
      return;
    }
    switch (message.type) {
      case AgentClientMessageType.Chat: return this.handleChat(connection, message);
      case AgentClientMessageType.ToolResult: return this.handleToolResult(connection, message);
      case AgentClientMessageType.Abort: return this.handleAbort(connection, message);
      case AgentClientMessageType.Register: return this.sendError(connection, "连接已初始化");
    }
  }

  private handleRegister(socket: WebSocket, message: AgentRegisterMessage): void {
    if (!this.authorized(message.token)) return void socket.close(1008, "invalid token");
    const connection = new RemoteWSAgentConnection(socket, this.wsOptions.logger);
    this.connections.add(connection);
    this.socketConnections.set(socket, connection);
    connection.emit(AgentServerMessageType.Ready);
  }

  private sendSocketError(socket: WebSocket, message: string): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: AgentServerMessageType.Error, data: { message } }));
  }
}

function parseMessage(raw: RawData): AgentClientMessage | undefined {
  try {
    const value = JSON.parse(raw.toString()) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const type = (value as { type?: unknown }).type;
    return Object.values(AgentClientMessageType).includes(type as AgentClientMessageType) ? value as AgentClientMessage : undefined;
  } catch {
    return undefined;
  }
}
