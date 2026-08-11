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
    // 入队即返回；推 UI 延迟到成为队首 active 时（onActivate），计时也从那一刻起算。
    // 主/子 agent 并发触发的审批因此被串行展示，用户逐个点击。
    const { id, promise } = this.session.enterApproval(
      toolCall, this.approvalTimeoutMs, this.approvalTimeoutValue,
      (activeId, remainSec) => { void this.enterApproval(activeId, remainSec, toolCall); },
    );
    try {
      return await promise;
    } finally {
      try { await this.exitApproval(id); } catch {}
    }
  }

  async executeAsk(params: AskToolParams): Promise<AskResponse> {
    const { id, promise } = this.session.enterAsk(
      params, this.askTimeoutMs, this.askTimeoutMessage,
      (activeId, remainSec) => { void this.enterAsk(activeId, remainSec, params); },
    );
    try {
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
