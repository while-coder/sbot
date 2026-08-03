import { timingSafeEqual } from "node:crypto";
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
  AgentServerMessageType,
  type AgentChatMessage,
  type AgentSessionIdentity,
  type AgentSessionInfo,
  type AgentToolResultMessage,
  type AgentUserInfo,
} from "./protocol";

export interface RemoteAgentServiceOptions {
  accessToken: string;
  logger?: ILogger;
  onReceiveMessage: (userId: string, userInfo: AgentUserInfo, sessionInfo: AgentSessionInfo, args: RemoteAgentMessageArgs, query: MessageContent) => Promise<void>;
  onTriggerAction: (userId: string, userInfo: AgentUserInfo, sessionInfo: AgentSessionInfo, args: RemoteAgentActionArgs) => Promise<void>;
}

/** Shared channel/session relay for every external-agent transport. */
export abstract class RemoteAgentService implements IChannelService {
  constructor(protected readonly options: RemoteAgentServiceOptions) {}

  abstract start(): Promise<void>;
  abstract dispose(): void;

  createSessionHandler(session: SessionService): ChannelSessionHandler {
    return new RemoteAgentSessionHandler(session);
  }

  protected authorized(token: unknown): boolean {
    const expected = Buffer.from(this.options.accessToken);
    const received = Buffer.from(text(token));
    return expected.length === received.length && timingSafeEqual(expected, received);
  }

  protected async handleChat(connection: RemoteAgentConnection, message: AgentChatMessage): Promise<void> {
    const content = text(message.text);
    if (!content) return this.sendError(connection, "消息不能为空");
    const identity = this.readIdentity(connection, message);
    if (!identity) return;
    if (typeof message.systemPrompt !== "string") return this.sendError(connection, "缺少 systemPrompt");
    if (!Array.isArray(message.tools)) return this.sendError(connection, "缺少 tools");

    connection.updateFromChat(message);
    await this.options.onReceiveMessage(identity.userId, identity.userInfo, identity.sessionInfo, {
      sessionId: identity.sessionId,
      connection,
      extraInfo: connection.extraInfo,
    }, content);
  }

  protected handleToolResult(connection: RemoteAgentConnection, message: AgentToolResultMessage): void {
    const callId = text(message.callId);
    if (callId) connection.receiveToolResult(callId, text(message.output), message.isError === true);
  }

  protected async handleAbort(connection: RemoteAgentConnection, message: AgentSessionIdentity): Promise<void> {
    const identity = this.readIdentity(connection, message);
    if (!identity) return;
    await this.options.onTriggerAction(identity.userId, identity.userInfo, identity.sessionInfo, {
      action: "abort",
      sessionId: identity.sessionId,
    });
  }

  protected sendError(connection: RemoteAgentConnection, message: string): void {
    connection.emit(AgentServerMessageType.Error, { message });
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
    this.sendError(connection, message);
    return undefined;
  }
}

export function parseObject(raw: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

export function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function info<T extends AgentUserInfo | AgentSessionInfo>(value: unknown): T | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as T : undefined;
}
