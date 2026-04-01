import {
  ChatMessage,
  ChatToolCall,
  AskResponse,
  AskToolParams,
  MessageRole,
  MessageType,
  NowDate,
  ToolApproval,
} from "scorpio.ai";
import { SessionService } from "./SessionService";
import { AgentToolHelpers, ProcessAIHandler } from "./ChannelPlugin";

export enum ToolCallStatus {
  None = "none",
  Wait = "wait",
  Allow = "allow",
  AlwaysArgs = "alwaysArgs",
  AlwaysTool = "alwaysTool",
  Deny = "deny",
}

export abstract class ChannelSessionHandler {
  protected readonly session: SessionService;

  constructor(session: SessionService) {
    this.session = session;
  }

  abstract onProcessStart(query: string, args: any, messageType: MessageType): Promise<void>;
  abstract onProcessEnd(query: string, args: any, messageType: MessageType, error?: any): Promise<void>;
  async onCommandResult(content: string, _args: any): Promise<void> {
    return this.onChatMessage({ role: MessageRole.AI, content, isCommand: true });
  }
  private _processAIHandler?: ProcessAIHandler;

  setProcessAIHandler(handler: ProcessAIHandler): void {
    this._processAIHandler = handler;
  }

  async processAI(query: string, args: any): Promise<void> {
    if (!this._processAIHandler) {
      throw new Error("processAI handler not set. Call setProcessAIHandler first.");
    }
    return this._processAIHandler(query, args, this);
  }

  buildExtraInfo(_userInfo: any): string {
    return "";
  }

  buildAgentTools(_args: any, _helpers: AgentToolHelpers): any[] {
    return [];
  }
  async onAgentStreamMessage(_message: ChatMessage): Promise<void> {}
  abstract onChatMessage(message: ChatMessage): Promise<void>;

  protected abstract enterApproval(approvalId: string, remainSec: number, toolCall: ChatToolCall): Promise<void>;
  protected abstract exitApproval(approvalId: string): Promise<void>;
  protected abstract enterAsk(askId: string, remainSec: number, params: AskToolParams): Promise<void>;
  protected abstract exitAsk(askId: string): Promise<void>;

  protected getApprovalTimeout(): number {
    return 300 * 1000;
  }
  async executeApproval(toolCall: ChatToolCall): Promise<ToolApproval> {
    const { id, promise } = this.session.enterApproval(toolCall, this.getApprovalTimeout());
    const end = NowDate() + this.getApprovalTimeout();
    try {
      await this.enterApproval(id, Math.floor((end - NowDate()) / 1000), toolCall);
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

  protected getAskTimeout(): number {
    return 600 * 1000;
  }
  async executeAsk(params: AskToolParams): Promise<AskResponse> {
    const { id, promise } = this.session.enterAsk(params, this.getAskTimeout());
    const end = NowDate() + this.getAskTimeout();
    try {
      await this.enterAsk(id, Math.floor((end - NowDate()) / 1000), params);
      return await promise;
    } finally {
      try { await this.exitAsk(id); } catch {}
    }
  }
  protected resolveAsk(askId: string, answers: Record<string, string | string[] | boolean | undefined>): void {
    this.session.exitAsk(askId, answers);
  }

  protected abort(): void {
    this.session.source.cancel();
  }
}
