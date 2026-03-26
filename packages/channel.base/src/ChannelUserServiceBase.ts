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
import { sessionManager } from "./SessionManager";

export enum ToolCallStatus {
  None = "none",
  Wait = "wait",
  Allow = "allow",
  AlwaysArgs = "alwaysArgs",
  AlwaysTool = "alwaysTool",
  Deny = "deny",
}

export abstract class ChannelUserServiceBase {
  /** 由子类在 processAIMessage 开始时设置，供 executeApproval / executeAsk 使用 */
  protected threadId: string = '';

  abstract startProcessMessage(query: string, args: any, messageType: MessageType): Promise<string>;
  async onMessageProcessed(_args: any, _messageType: MessageType): Promise<void> {}
  abstract processMessageError(e: any, args: any, messageType: MessageType): Promise<void>;
  async onCommandOutput(content: string, _args: any): Promise<void> {
    return this.onAgentMessage({ type: MessageChunkType.COMMAND, content });
  }
  abstract onAgentMessage(message: AgentMessage): Promise<void>;
  abstract processAIMessage(query: string, args: any): Promise<void>;

  protected abstract sendApproval(toolCall: AgentToolCall, id: string, remainSec: number): Promise<void>;
  protected abstract clearApproval(toolCallId: string): Promise<void>;
  protected abstract sendAsk(params: AskToolParams, askId: string, remainSec: number): Promise<void>;
  protected abstract clearAsk(askId: string): Promise<void>;

  protected resolveApproval(id: string, status: ToolCallStatus): void {
    const statusToApproval: Partial<Record<ToolCallStatus, ToolApproval>> = {
      [ToolCallStatus.Allow]: ToolApproval.Allow,
      [ToolCallStatus.AlwaysArgs]: ToolApproval.AlwaysArgs,
      [ToolCallStatus.AlwaysTool]: ToolApproval.AlwaysTool,
    };
    sessionManager.exitApproval(this.threadId, id, statusToApproval[status] ?? ToolApproval.Deny);
  }

  protected getApprovalTimeout(): number {
    return 300 * 1000;
  }

  protected getAskTimeout(): number {
    return 600 * 1000;
  }

  async executeApproval(toolCall: AgentToolCall): Promise<ToolApproval> {
    const timeoutMs = this.getApprovalTimeout();
    const { id, promise } = sessionManager.enterApproval(this.threadId, toolCall, timeoutMs);
    const end = NowDate() + timeoutMs;
    try {
      await this.sendApproval(toolCall, id, Math.floor((end - NowDate()) / 1000));
      return await promise;
    } finally {
      try { await this.clearApproval(id); } catch {}
    }
  }

  async executeAsk(params: AskToolParams): Promise<AskResponse> {
    const { id, promise } = sessionManager.enterAsk(this.threadId, params, this.getAskTimeout());
    const end = NowDate() + this.getAskTimeout();
    try {
      await this.sendAsk(params, id, Math.floor((end - NowDate()) / 1000));
      return await promise;
    } finally {
      try { await this.clearAsk(id); } catch {}
    }
  }

  protected resolveAsk(askId: string, answers: Record<string, string | string[] | boolean | undefined>): void {
    sessionManager.exitAsk(this.threadId, askId, answers);
  }

  protected rejectAsk(askId: string, reason = 'User cancelled'): void {
    sessionManager.exitAsk(this.threadId, askId, reason);
  }
}
