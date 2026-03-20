import {
  AgentMessage,
  AgentToolCall,
  AskQuestionType,
  AskResponse,
  AskToolParams,
  MessageChunkType,
  MessageType,
  NowDate,
  sleep,
  ToolApproval,
} from "scorpio.ai";

export enum ToolCallStatus {
  None = "none",
  Wait = "wait",
  Allow = "allow",
  AlwaysArgs = "alwaysArgs",
  AlwaysTool = "alwaysTool",
  Deny = "deny",
}

interface ToolCallEntry {
  status: ToolCallStatus;
}

export enum AskStatus {
  Wait = "wait",
  Done = "done",
  Timeout = "timeout",
}

interface AskEntry {
  status: AskStatus;
  params: AskToolParams;
  response?: AskResponse;
}

export abstract class ChannelUserServiceBase {
  private toolCallMap = new Map<string, ToolCallEntry>();
  private askMap = new Map<string, AskEntry>();

  abstract startProcessMessage(query: string, args: any, messageType: MessageType): Promise<string>;
  async onMessageProcessed(_args: any, _messageType: MessageType): Promise<void> {}
  abstract processMessageError(e: any, args: any, messageType: MessageType): Promise<void>;
  async onCommandOutput(content: string, _args: any): Promise<void> {
    return this.onAgentMessage({ type: MessageChunkType.COMMAND, content });
  }
  abstract onAgentMessage(message: AgentMessage): Promise<void>;
  abstract processAIMessage(query: string, args: any): Promise<void>;

  protected abstract sendApprovalUI(toolCall: AgentToolCall, remainSec: number): Promise<void>;
  protected abstract clearApprovalUI(toolCallId: string): Promise<void>;
  protected abstract sendAskForm(params: AskToolParams, askId: string, remainSec: number): Promise<void>;
  protected abstract clearAskForm(askId: string): Promise<void>;

  protected resolveToolCall(id: string, approval: ToolCallStatus): void {
    const entry = this.toolCallMap.get(id);
    if (entry) entry.status = approval;
  }

  protected getToolCallTimeout(): number {
    return 300 * 1000;
  }

  protected getAskTimeout(): number {
    return 600 * 1000;
  }

  async executeAgentTool(toolCall: AgentToolCall): Promise<ToolApproval> {
    let id = toolCall.id ?? `tc-${Date.now()}`;
    while (this.toolCallMap.has(id)) id = `tc-${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const entry: ToolCallEntry = { status: ToolCallStatus.Wait };
    this.toolCallMap.set(id, entry);
    try {
      const end = NowDate() + this.getToolCallTimeout();
      let lastSend = 0;
      while (entry.status === ToolCallStatus.Wait) {
        if (NowDate() - lastSend > 300) {
          lastSend = NowDate();
          const remainSec = Math.floor((end - NowDate()) / 1000);
          await this.sendApprovalUI(toolCall, remainSec);
        }
        await sleep(10);
        if (NowDate() > end) {
          entry.status = ToolCallStatus.Deny;
          break;
        }
      }
      const statusToApproval: Partial<Record<ToolCallStatus, ToolApproval>> = {
        [ToolCallStatus.Allow]: ToolApproval.Allow,
        [ToolCallStatus.AlwaysArgs]: ToolApproval.AlwaysArgs,
        [ToolCallStatus.AlwaysTool]: ToolApproval.AlwaysTool,
      };
      return statusToApproval[entry.status] ?? ToolApproval.Deny;
    } finally {
      try { await this.clearApprovalUI(id); } catch {}
      this.toolCallMap.delete(id);
    }
  }

  async ask(params: AskToolParams): Promise<AskResponse> {
    let askId = `ask_${Date.now()}`;
    while (this.askMap.has(askId)) askId = `ask_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const askState: AskEntry = { status: AskStatus.Wait, params };
    this.askMap.set(askId, askState);
    try {
      const end = NowDate() + this.getAskTimeout();
      const remainSec = Math.floor((end - NowDate()) / 1000);
      await this.sendAskForm(params, askId, remainSec);
      while (askState.status === AskStatus.Wait) {
        await sleep(10);
        if (NowDate() > end) {
          askState.status = AskStatus.Timeout;
          break;
        }
      }
    } finally {
      try { await this.clearAskForm(askId); } catch {}
      this.askMap.delete(askId);
    }

    const { status, response } = askState;

    if (status !== AskStatus.Done || !response)
      throw new Error("User did not answer within the allotted time");
    return response;
  }

  protected resolveAskResponse(askId: string, answers: Record<string, string | string[] | boolean | undefined>): void {
    const state = this.askMap.get(askId);
    if (!state) return;
    const response: AskResponse = {};
    for (let i = 0; i < state.params.questions.length; i++) {
      const q = state.params.questions[i];
      const raw = answers[`${i}`];
      if (q.type === AskQuestionType.Toggle) {
        // normalize: boolean (Lark), ["true"]/[] (Slack), "true"/"false" (Web)
        if (typeof raw === 'boolean') response[q.label] = String(raw);
        else if (Array.isArray(raw)) response[q.label] = raw.includes('true') ? 'true' : 'false';
        else response[q.label] = raw === 'true' ? 'true' : 'false';
      } else if (raw !== undefined) {
        response[q.label] = raw as string | string[];
      }
    }
    state.response = response;
    state.status = AskStatus.Done;
  }
}
