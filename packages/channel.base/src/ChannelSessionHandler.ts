import {
  ChatMessage,
  ChatToolCall,
  MessageType,
  ToolApproval,
  type MessageContent,
} from "scorpio.ai";
import { type AskResponse, type AskToolParams } from "./AskTool";
import { type StructuredToolInterface } from "@langchain/core/tools";
import { SessionService } from "./SessionService";
import { ChannelMessageArgs, ProcessAIHandler } from "./ChannelPlugin";
import { AbstractChatProvider } from "./AbstractChatProvider";

export enum ToolCallStatus {
  None = "none",
  Wait = "wait",
  Allow = "allow",
  AlwaysArgs = "alwaysArgs",
  AlwaysTool = "alwaysTool",
  Deny = "deny",
}

export abstract class ChannelSessionHandler<TProvider extends AbstractChatProvider = AbstractChatProvider> {
  readonly session: SessionService;
  protected provider?: TProvider;

  /** 由上层（如 createProcessAIHandler）按 agent 配置写入；默认 0=不超时 */
  approvalTimeoutMs = 0;
  approvalTimeoutValue: ToolApproval = ToolApproval.Deny;
  askTimeoutMs = 0;
  askTimeoutMessage = 'User did not answer within the allotted time';

  private _processAIHandler?: ProcessAIHandler;

  constructor(session: SessionService) {
    this.session = session;
  }

  // Channel lifecycle
  abstract onProcessStart(query: MessageContent, args: ChannelMessageArgs, messageType: MessageType): Promise<string | void>;
  abstract onProcessEnd(query: MessageContent, args: ChannelMessageArgs, messageType: MessageType, error?: any): Promise<void>;
  async onStreamMessage(message: ChatMessage, _args: ChannelMessageArgs): Promise<void> {
    this.provider?.setStreamMessage(message);
  }

  async onChatMessage(message: ChatMessage, _args: ChannelMessageArgs): Promise<void> {
    this.provider?.resetStreamMessage();
    this.provider?.addAIMessage(message);
  }

  // Optional channel extensions
  async buildAgentTools(_args: ChannelMessageArgs): Promise<StructuredToolInterface[]> {
    return [];
  }

  async onTriggerAction(..._args: any[]): Promise<void> {}

  // AI execution bridge
  setProcessAIHandler(handler: ProcessAIHandler): void {
    this._processAIHandler = handler;
  }

  async processAI(query: MessageContent, args: ChannelMessageArgs): Promise<void> {
    if (!this._processAIHandler) {
      throw new Error("processAI handler not set. Call setProcessAIHandler first.");
    }
    return this._processAIHandler(query, args, this);
  }

  // Framework entrypoints. Channels should customize the protected hooks below.
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

  // Channel interaction hooks
  protected async enterApproval(approvalId: string, _remainSec: number, _toolCall: ChatToolCall): Promise<void> {
    this.resolveApproval(approvalId, ToolCallStatus.Allow);
  }
  protected async exitApproval(_approvalId: string): Promise<void> {}
  protected async enterAsk(_askId: string, _remainSec: number, _params: AskToolParams): Promise<void> {}
  protected async exitAsk(_askId: string): Promise<void> {}

  protected resolveApproval(id: string, status: ToolCallStatus): void {
    const statusToApproval: Partial<Record<ToolCallStatus, ToolApproval>> = {
      [ToolCallStatus.Allow]: ToolApproval.Allow,
      [ToolCallStatus.AlwaysArgs]: ToolApproval.AlwaysArgs,
      [ToolCallStatus.AlwaysTool]: ToolApproval.AlwaysTool,
    };
    this.session.exitApproval(id, statusToApproval[status] ?? ToolApproval.Deny);
  }

  protected resolveAsk(askId: string, answers: Record<string, string | string[] | boolean | undefined>): void {
    this.session.exitAsk(askId, answers);
  }

  protected abort(): void {
    this.session.abort();
  }
}
