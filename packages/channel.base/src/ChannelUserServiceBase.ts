import {
  AgentMessage,
  AgentToolCall,
  AskResponse,
  AskToolParams,
  MessageChunkType,
  MessageType,
  NowDate,
  ToolApproval,
} from "scorpio.ai";
import { SessionManager } from "./SessionManager";

export enum ToolCallStatus {
  None = "none",
  Wait = "wait",
  Allow = "allow",
  AlwaysArgs = "alwaysArgs",
  AlwaysTool = "alwaysTool",
  Deny = "deny",
}

export abstract class ChannelUserServiceBase {
  protected readonly sessionManager: SessionManager;
  readonly threadId: string;

  constructor(sessionManager: SessionManager, threadId: string) {
    this.sessionManager = sessionManager;
    this.threadId = threadId;
  }

  abstract onProcessStart(query: string, args: any, messageType: MessageType): Promise<void>;
  abstract onProcessEnd(query: string, args: any, messageType: MessageType, error?: any): Promise<void>;
  async onCommandResult(content: string, _args: any): Promise<void> {
    return this.onAgentMessage({ type: MessageChunkType.COMMAND, content });
  }
  abstract processAI(query: string, args: any): Promise<void>;
  async onAgentStreamMessage(_message: AgentMessage): Promise<void> {}
  abstract onAgentMessage(message: AgentMessage): Promise<void>;

  protected abstract enterApproval(approvalId: string, remainSec: number, toolCall: AgentToolCall): Promise<void>;
  protected abstract exitApproval(approvalId: string): Promise<void>;
  protected abstract enterAsk(askId: string, remainSec: number, params: AskToolParams): Promise<void>;
  protected abstract exitAsk(askId: string): Promise<void>;

  protected getApprovalTimeout(): number {
    return 300 * 1000;
  }
  async executeApproval(toolCall: AgentToolCall): Promise<ToolApproval> {
    const { id, promise } = this.sessionManager.enterApproval(this.threadId, toolCall, this.getApprovalTimeout());
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
    this.sessionManager.exitApproval(this.threadId, id, statusToApproval[status] ?? ToolApproval.Deny);
  }

  protected getAskTimeout(): number {
    return 600 * 1000;
  }
  async executeAsk(params: AskToolParams): Promise<AskResponse> {
    const { id, promise } = this.sessionManager.enterAsk(this.threadId, params, this.getAskTimeout());
    const end = NowDate() + this.getAskTimeout();
    try {
      await this.enterAsk(id, Math.floor((end - NowDate()) / 1000), params);
      return await promise;
    } finally {
      try { await this.exitAsk(id); } catch {}
    }
  }
  protected resolveAsk(askId: string, answers: Record<string, string | string[] | boolean | undefined>): void {
    this.sessionManager.exitAsk(this.threadId, askId, answers);
  }

  protected abort(): void {
    this.sessionManager.abort(this.threadId);
  }
}
