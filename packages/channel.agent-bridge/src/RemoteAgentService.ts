import { timingSafeEqual } from "node:crypto";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import {
  type ChannelSessionHandler,
  type IChannelService,
  type ILogger,
  type MessageContent,
  type SessionService,
} from "channel.base";
import { RemoteAgentConnection } from "./RemoteAgentConnection";
import {
  RemoteAgentSessionHandler,
  type RemoteAgentActionArgs,
  type RemoteAgentMessageArgs,
} from "./RemoteAgentSessionHandler";
import {
  AgentClientMessageType,
  AgentServerMessageType,
  type AgentChatMessage,
  type AgentClientMessage,
  type AgentRegisterMessage,
  type AgentSessionIdentity,
  type AgentSessionInfo,
  type AgentToolResultMessage,
  type AgentUserInfo,
} from "./protocol";

export interface RemoteAgentServiceOptions {
  port: number;
  host?: string;
  accessToken: string;
  logger?: ILogger;
  onReceiveMessage: (userId: string, userInfo: AgentUserInfo, sessionInfo: AgentSessionInfo, args: RemoteAgentMessageArgs, query: MessageContent) => Promise<void>;
  onTriggerAction: (userId: string, userInfo: AgentUserInfo, sessionInfo: AgentSessionInfo, args: RemoteAgentActionArgs) => Promise<void>;
}

/** A relay between authenticated external clients and sbot channel sessions. */
export class RemoteAgentService implements IChannelService {
  private readonly connections = new Set<RemoteAgentConnection>();
  private readonly socketConnections = new WeakMap<WebSocket, RemoteAgentConnection>();
  private server?: WebSocketServer;
  private disposed = false;

  constructor(private readonly options: RemoteAgentServiceOptions) {}

  async start(): Promise<void> {
    if (this.server) return;
    const server = this.server = new WebSocketServer({ host: this.options.host, port: this.options.port });
    await new Promise<void>((resolve, reject) => {
      const onListening = (): void => {
        server.off("error", onStartupError);
        resolve();
      };
      const onStartupError = (error: Error): void => {
        server.off("listening", onListening);
        reject(error);
      };
      server.once("listening", onListening);
      server.once("error", onStartupError);
    });

    server.on("error", error => this.options.logger?.error(`Agent bridge WebSocket server error: ${error.message}`));
    server.on("connection", socket => this.accept(socket));
    this.options.logger?.info(`Agent bridge WebSocket listening on ws://${this.options.host || "0.0.0.0"}:${this.options.port}`);
  }

  createSessionHandler(session: SessionService): ChannelSessionHandler {
    return new RemoteAgentSessionHandler(session);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const connection of this.connections) connection.close();
    this.connections.clear();
    this.server?.close();
    this.server = undefined;
  }

  private accept(socket: WebSocket): void {
    socket.on("message", raw => {
      void this.onMessage(socket, raw).catch(error => {
        this.options.logger?.warn(`Agent bridge WebSocket message failed: ${error instanceof Error ? error.message : String(error)}`);
        this.sendError(this.socketConnections.get(socket), socket, "请求处理失败");
      });
    });
    socket.on("error", error => this.options.logger?.warn(`Agent bridge WebSocket client error: ${error.message}`));
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
      this.sendError(connection, socket, "无效的客户端消息");
      return;
    }

    if (!connection) {
      if (message.type !== AgentClientMessageType.Register) {
        socket.close(1008, "register required");
        return;
      }
      await this.handleRegister(socket, message);
      return;
    }

    switch (message.type) {
      case AgentClientMessageType.Chat:
        await this.handleChat(connection, message);
        return;
      case AgentClientMessageType.ToolResult:
        this.handleToolResult(connection, message);
        return;
      case AgentClientMessageType.Abort:
        await this.handleAbort(connection, message);
        return;
      case AgentClientMessageType.Register:
        this.sendError(connection, socket, "连接已初始化");
        return;
    }
  }

  private async handleRegister(socket: WebSocket, message: AgentRegisterMessage): Promise<void> {
    const expected = Buffer.from(this.options.accessToken);
    const received = Buffer.from(text(message.token));
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      socket.close(1008, "invalid token");
      return;
    }
    const connection = new RemoteAgentConnection(socket, this.options.logger);
    this.connections.add(connection);
    this.socketConnections.set(socket, connection);
    connection.emit(AgentServerMessageType.Ready);
  }

  private async handleChat(connection: RemoteAgentConnection, message: AgentChatMessage): Promise<void> {
    const content = text(message.text);
    if (!content) {
      this.sendError(connection, undefined, "消息不能为空");
      return;
    }
    const identity = this.readIdentity(connection, message);
    if (!identity) return;
    if (typeof message.systemPrompt !== "string") {
      this.sendError(connection, undefined, "缺少 systemPrompt");
      return;
    }
    if (!Array.isArray(message.tools)) {
      this.sendError(connection, undefined, "缺少 tools");
      return;
    }
    connection.updateFromChat(message);
    await this.options.onReceiveMessage(identity.userId, identity.userInfo, identity.sessionInfo, {
      sessionId: identity.sessionId,
      connection,
      extraInfo: connection.extraInfo,
    }, content);
  }

  private handleToolResult(connection: RemoteAgentConnection, message: AgentToolResultMessage): void {
    const callId = text(message.callId);
    if (!callId) return;
    connection.receiveToolResult(callId, text(message.output), message.isError === true);
  }

  private async handleAbort(connection: RemoteAgentConnection, message: AgentSessionIdentity): Promise<void> {
    const identity = this.readIdentity(connection, message);
    if (!identity) return;
    await this.options.onTriggerAction(identity.userId, identity.userInfo, identity.sessionInfo, {
      action: "abort",
      sessionId: identity.sessionId,
    });
  }

  private readIdentity(connection: RemoteAgentConnection, value: AgentSessionIdentity): AgentSessionIdentity | undefined {
    const userId = text(value.userId);
    if (!userId) return this.identityError(connection, "缺少 userId");
    const sessionId = text(value.sessionId);
    if (!sessionId) return this.identityError(connection, "缺少 sessionId");
    const userInfo = info<AgentUserInfo>(value.userInfo);
    if (!userInfo) return this.identityError(connection, "缺少 userInfo");
    const sessionInfo = info<AgentSessionInfo>(value.sessionInfo);
    if (!sessionInfo) return this.identityError(connection, "缺少 sessionInfo");
    return { userId, userInfo, sessionId, sessionInfo };
  }

  private identityError(connection: RemoteAgentConnection, message: string): undefined {
    this.sendError(connection, undefined, message);
    return undefined;
  }

  private sendError(connection: RemoteAgentConnection | undefined, socket: WebSocket | undefined, message: string): void {
    if (connection) {
      connection.emit(AgentServerMessageType.Error, { message });
      return;
    }
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: AgentServerMessageType.Error, data: { message } }));
    }
  }
}

function parseMessage(raw: RawData): AgentClientMessage | undefined {
  try {
    const value = JSON.parse(raw.toString()) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const type = (value as { type?: unknown }).type;
    return Object.values(AgentClientMessageType).includes(type as AgentClientMessageType)
      ? value as AgentClientMessage
      : undefined;
  } catch {
    return undefined;
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function info<T extends AgentUserInfo | AgentSessionInfo>(value: unknown): T | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as T
    : undefined;
}
