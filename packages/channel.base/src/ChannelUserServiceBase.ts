import {
  AgentMessage,
  AgentToolCall,
  AskResponse,
  AskToolParams,
  NowDate,
  sleep,
  ToolApproval,
  UserServiceBase,
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

export abstract class ChannelUserServiceBase extends UserServiceBase {
  private toolCallMap = new Map<string, ToolCallEntry>();
  private askMap = new Map<string, AskEntry>();

  protected abstract sendApprovalUI(toolCall: AgentToolCall, remainSec: number): Promise<void>;
  protected abstract clearApprovalUI(toolCallId: string): Promise<void>;
  protected abstract sendAskForm(params: AskToolParams, askId: string): Promise<void>;
  protected abstract clearAskForm(askId: string): Promise<void>;

  protected resolveToolCall(id: string, approval: ToolCallStatus): void {
    const entry = this.toolCallMap.get(id);
    if (entry) entry.status = approval;
  }

  protected getToolCallTimeout(): number {
    return 300 * 1000;
  }

  async executeAgentTool(toolCall: AgentToolCall): Promise<ToolApproval> {
    let id = toolCall.id ?? `tc-${Date.now()}`;
    while (this.toolCallMap.has(id)) id = `tc-${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const entry: ToolCallEntry = { status: ToolCallStatus.Wait };
    this.toolCallMap.set(id, entry);
    try {
      const timeout = this.getToolCallTimeout();
      const end = NowDate() + timeout;
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
    await this.sendAskForm(params, askId);

    const end = NowDate() + 5 * 60 * 1000;
    while (askState.status === AskStatus.Wait) {
      await sleep(10);
      if (NowDate() > end) {
        askState.status = AskStatus.Timeout;
        break;
      }
    }

    const status = askState.status;
    const response = askState.response;
    try {
      await this.clearAskForm(askId);
    } finally {
      this.askMap.delete(askId);
    }

    if (status !== AskStatus.Done || !response)
      throw new Error("User did not answer within the allotted time");
    return response;
  }

  protected resolveAskResponse(askId: string, answers: Record<string, string | string[] | undefined>): void {
    const state = this.askMap.get(askId);
    if (!state) return;
    const response: AskResponse = {};
    for (let i = 0; i < state.params.questions.length; i++) {
      const val = answers[`${i}`];
      if (val !== undefined) response[state.params.questions[i].label] = val;
    }
    state.response = response;
    state.status = AskStatus.Done;
  }
}
