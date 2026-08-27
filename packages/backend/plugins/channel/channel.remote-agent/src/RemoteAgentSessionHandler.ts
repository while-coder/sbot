import { createAgentTool } from "channel.base";
import {
  ChannelSessionHandler,
  ToolApproval,
  formatError,
  type ChannelMessageArgs,
  type ChatMessage,
  type ChatToolCall,
  type MessageContent,
  type MessageType,
  type SessionService,
  type AgentTool,
} from "channel.base";
import { AgentServerMessageType } from "./protocol";
import type { RemoteAgentConnection } from "./RemoteAgentConnection";

export interface RemoteAgentMessageArgs extends ChannelMessageArgs {
  connection: RemoteAgentConnection;
}

export interface RemoteAgentActionArgs {
  action: "abort";
  sessionId: string;
}

/** Bridges one sbot session to its currently connected external agent client. */
export class RemoteAgentSessionHandler extends ChannelSessionHandler {
  private connection?: RemoteAgentConnection;

  constructor(session: SessionService) {
    super(session);
  }

  async onProcessStart(_query: MessageContent, args: ChannelMessageArgs, _messageType: MessageType): Promise<void> {
    this.connection = (args as RemoteAgentMessageArgs).connection;
  }

  async onProcessEnd(_query: MessageContent, _args: ChannelMessageArgs, _messageType: MessageType, error?: unknown): Promise<void> {
    if (error) this.emit(AgentServerMessageType.Error, { message: formatError(error) });
    this.emit(AgentServerMessageType.Done);
  }

  async onChatMessage(message: ChatMessage, _args: ChannelMessageArgs): Promise<void> {
    this.emit(AgentServerMessageType.Message, { message, createdAt: Date.now() / 1000 });
  }

  async onStreamMessage(message: ChatMessage, _args: ChannelMessageArgs): Promise<void> {
    this.emit(AgentServerMessageType.Stream, { content: message.content ?? "" });
  }

  async executeApproval(_toolCall: ChatToolCall): Promise<ToolApproval> {
    return ToolApproval.Allow;
  }

  async buildAgentTools(args: ChannelMessageArgs): Promise<AgentTool[]> {
    const connection = (args as RemoteAgentMessageArgs).connection ?? this.connection;
    if (!connection) return [];

    return connection.getTools().map(definition => createAgentTool({
      name: definition.name,
      description: definition.description?.trim() || definition.name,
      schema: definition.inputSchema as any,
      func: async (input: Record<string, unknown>): Promise<string> => {
        const result = await connection.callTool(definition.name, input ?? {}, this.session.signal);
        return result.isError ? `客户端工具执行失败：${result.output}` : result.output;
      },
    }));
  }

  async onTriggerAction(args: RemoteAgentActionArgs): Promise<void> {
    this.abort();
  }

  private emit(type: AgentServerMessageType, data?: Record<string, unknown>): void {
    this.connection?.emit(type, data);
  }
}
