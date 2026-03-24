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
  /** 由子类在 processAIMessage 开始时设置，供 executeAgentTool / ask 使用 */
  protected threadId: string = '';

  abstract startProcessMessage(query: string, args: any, messageType: MessageType): Promise<string>;
  async onMessageProcessed(_args: any, _messageType: MessageType): Promise<void> {}
  abstract processMessageError(e: any, args: any, messageType: MessageType): Promise<void>;
  async onCommandOutput(content: string, _args: any): Promise<void> {
    return this.onAgentMessage({ type: MessageChunkType.COMMAND, content });
  }
  abstract onAgentMessage(message: AgentMessage): Promise<void>;
  abstract processAIMessage(query: string, args: any): Promise<void>;

  protected abstract sendApprovalUI(toolCall: AgentToolCall, id: string, remainSec: number): Promise<void>;
  protected abstract clearApprovalUI(toolCallId: string): Promise<void>;
  protected abstract sendAskForm(params: AskToolParams, askId: string, remainSec: number): Promise<void>;
  protected abstract clearAskForm(askId: string): Promise<void>;

  /** 将 ToolCallStatus 映射为 ToolApproval 并通过 sessionManager 解决 */
  protected resolveToolCall(id: string, status: ToolCallStatus): void {
    const statusToApproval: Partial<Record<ToolCallStatus, ToolApproval>> = {
      [ToolCallStatus.Allow]: ToolApproval.Allow,
      [ToolCallStatus.AlwaysArgs]: ToolApproval.AlwaysArgs,
      [ToolCallStatus.AlwaysTool]: ToolApproval.AlwaysTool,
    };
    sessionManager.exitToolApproval(this.threadId, id, statusToApproval[status] ?? ToolApproval.Deny);
  }

  protected getToolCallTimeout(): number {
    return 300 * 1000;
  }

  protected getAskTimeout(): number {
    return 600 * 1000;
  }

  async executeAgentTool(toolCall: AgentToolCall): Promise<ToolApproval> {
    const timeoutMs = this.getToolCallTimeout();
    const { id, promise } = sessionManager.enterToolApproval(this.threadId, timeoutMs);
    const end = NowDate() + timeoutMs;
    try {
      await this.sendApprovalUI(toolCall, id, Math.floor((end - NowDate()) / 1000));
      return await promise;
    } finally {
      try { await this.clearApprovalUI(id); } catch {}
    }
  }

  async ask(params: AskToolParams): Promise<AskResponse> {
    const { id, promise } = sessionManager.enterAsk(this.threadId, params, this.getAskTimeout());
    const end = NowDate() + this.getAskTimeout();
    try {
      await this.sendAskForm(params, id, Math.floor((end - NowDate()) / 1000));
      return await promise;
    } finally {
      try { await this.clearAskForm(id); } catch {}
    }
  }

  /** 薄包装：channel 子类调用此方法提交用户的 ask 表单回答 */
  protected resolveAskResponse(askId: string, answers: Record<string, string | string[] | boolean | undefined>): void {
    sessionManager.exitAsk(this.threadId, askId, answers);
  }

  /** 薄包装：channel 子类调用此方法取消 ask（以错误拒绝 promise） */
  protected rejectAskResponse(askId: string, reason = 'User cancelled'): void {
    sessionManager.exitAsk(this.threadId, askId, reason);
  }
}
