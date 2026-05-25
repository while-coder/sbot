import {
  ChatMessage,
  ChatToolCall,
  MessageRole,
  MessageType,
  ToolApproval,
  type MessageContent,
} from "scorpio.ai";
import { type AskResponse, type AskToolParams } from "./AskTool";
import { type StructuredToolInterface } from "@langchain/core/tools";
import { SessionService } from "./SessionService";
import { ChannelMessageArgs, ProcessAIHandler } from "./ChannelPlugin";

export enum ToolCallStatus {
  None = "none",
  Wait = "wait",
  Allow = "allow",
  AlwaysArgs = "alwaysArgs",
  AlwaysTool = "alwaysTool",
  Deny = "deny",
}

export abstract class ChannelSessionHandler {
  readonly session: SessionService;

  constructor(session: SessionService) {
    this.session = session;
  }

  abstract onProcessStart(query: MessageContent, args: ChannelMessageArgs, messageType: MessageType): Promise<string | void>;
  abstract onProcessEnd(query: MessageContent, args: ChannelMessageArgs, messageType: MessageType, error?: any): Promise<void>;
  async onCommandResult(content: string, args: ChannelMessageArgs): Promise<void> {
    return this.onChatMessage({ role: MessageRole.AI, content }, args);
  }
  private _processAIHandler?: ProcessAIHandler;

  setProcessAIHandler(handler: ProcessAIHandler): void {
    this._processAIHandler = handler;
  }

  async processAI(query: MessageContent, args: ChannelMessageArgs): Promise<void> {
    if (!this._processAIHandler) {
      throw new Error("processAI handler not set. Call setProcessAIHandler first.");
    }
    return this._processAIHandler(query, args, this);
  }

  buildAgentTools(_args: ChannelMessageArgs): StructuredToolInterface[] {
    return [];
  }
  abstract onStreamMessage(message: ChatMessage, args: ChannelMessageArgs): Promise<void>;
  abstract onChatMessage(message: ChatMessage, args: ChannelMessageArgs): Promise<void>;

  protected abstract enterApproval(approvalId: string, remainSec: number, toolCall: ChatToolCall): Promise<void>;
  protected abstract exitApproval(approvalId: string): Promise<void>;
  protected abstract enterAsk(askId: string, remainSec: number, params: AskToolParams): Promise<void>;
  protected abstract exitAsk(askId: string): Promise<void>;

  /** 由上层（如 createProcessAIHandler）按 agent 配置写入；默认 0=不超时 */
  approvalTimeoutMs = 0;
  approvalTimeoutValue: ToolApproval = ToolApproval.Deny;

  async executeApproval(toolCall: ChatToolCall): Promise<ToolApproval> {
    const timeout = this.approvalTimeoutMs;
    const { id, promise } = this.session.enterApproval(toolCall, timeout, this.approvalTimeoutValue);
    const remainSec = timeout > 0 ? Math.floor(timeout / 1000) : 0;
    try {
      await this.enterApproval(id, remainSec, toolCall);
      return await promise;
    } finally {
      try { await this.exitApproval(id); } catch {}
    }
  }
  protected resolveApproval(id: string, status: ToolCallStatus): void {
    const statusToApproval: Partial<Record<ToolCallStatus, ToolApproval>> = {
      [ToolCallStatus.Allow]: ToolApproval.Allow,
      [ToolCallStatus.AlwaysArgs]: ToolApproval.AlwaysArgs,
      [ToolCallStatus.AlwaysTool]: ToolApproval.AlwaysTool,
    };
    this.session.exitApproval(id, statusToApproval[status] ?? ToolApproval.Deny);
  }

  /** 由上层（如 createProcessAIHandler）按 agent 配置写入；默认 0=不超时 */
  askTimeoutMs = 0;
  askTimeoutMessage = 'User did not answer within the allotted time';

  async executeAsk(params: AskToolParams): Promise<AskResponse> {
    const timeout = this.askTimeoutMs;
    const { id, promise } = this.session.enterAsk(params, timeout, this.askTimeoutMessage);
    const remainSec = timeout > 0 ? Math.floor(timeout / 1000) : 0;
    try {
      await this.enterAsk(id, remainSec, params);
      return await promise;
    } finally {
      try { await this.exitAsk(id); } catch {}
    }
  }
  protected resolveAsk(askId: string, answers: Record<string, string | string[] | boolean | undefined>): void {
    this.session.exitAsk(askId, answers);
  }

  protected abort(): void {
    this.session.abort();
  }

  async onTriggerAction(..._args: any[]): Promise<void> {}
}
