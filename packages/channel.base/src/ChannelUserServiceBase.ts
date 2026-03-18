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

interface ToolCallState {
  id: string | undefined;
  status: ToolCallStatus;
}

interface AskState {
  id: string | undefined;
  status: "wait" | "done" | "timeout";
  questionMap: Record<string, string>;
  response?: AskResponse;
}

export abstract class ChannelUserServiceBase extends UserServiceBase {
  toolCall: ToolCallState = { id: undefined, status: ToolCallStatus.None };
  private askState: AskState = { id: undefined, status: "wait", questionMap: {} };

  protected abstract sendApprovalUI(toolCall: AgentToolCall, remainSec: number): Promise<void>;
  protected abstract clearApprovalUI(): Promise<void>;
  protected abstract sendAskForm(
    params: AskToolParams,
    askId: string,
    questionMap: Record<string, string>
  ): Promise<void>;
  protected abstract clearAskForm(): Promise<void>;

  async executeAgentTool(toolCall: AgentToolCall): Promise<ToolApproval> {
    this.toolCall.id = toolCall.id;
    this.toolCall.status = ToolCallStatus.Wait;
    try {
      const timeout = 30 * 1000;
      const end = NowDate() + timeout;
      let lastSend = 0;
      while (this.toolCall.status === ToolCallStatus.Wait) {
        if (NowDate() - lastSend > 300) {
          lastSend = NowDate();
          const remainSec = Math.floor((end - NowDate()) / 1000);
          await this.sendApprovalUI(toolCall, remainSec);
        }
        await sleep(10);
        if (NowDate() > end) {
          this.toolCall.status = ToolCallStatus.Deny;
          break;
        }
      }
      const statusToApproval: Partial<Record<ToolCallStatus, ToolApproval>> = {
        [ToolCallStatus.Allow]: ToolApproval.Allow,
        [ToolCallStatus.AlwaysArgs]: ToolApproval.AlwaysArgs,
        [ToolCallStatus.AlwaysTool]: ToolApproval.AlwaysTool,
      };
      return statusToApproval[this.toolCall.status] ?? ToolApproval.Deny;
    } finally {
      try { await this.clearApprovalUI(); } catch {}
      this.toolCall.id = undefined;
      this.toolCall.status = ToolCallStatus.None;
    }
  }

  async ask(params: AskToolParams): Promise<AskResponse> {
    const askId = `ask_${Date.now()}`;
    const questionMap: Record<string, string> = {};
    for (let i = 0; i < params.questions.length; i++) {
      questionMap[`q_${i}`] = params.questions[i].label;
    }

    this.askState = { id: askId, status: "wait", questionMap };
    await this.sendAskForm(params, askId, questionMap);

    const end = NowDate() + 5 * 60 * 1000;
    while (this.askState.status === "wait") {
      await sleep(10);
      if (NowDate() > end) {
        this.askState.status = "timeout";
        break;
      }
    }

    const status = this.askState.status;
    const response = this.askState.response;
    try {
      await this.clearAskForm();
    } finally {
      this.askState = { id: undefined, status: "wait", questionMap: {} };
    }

    if (status !== "done" || !response)
      throw new Error("User did not answer within the allotted time");
    return response;
  }

  protected resolveAskResponse(askId: string, answers: Record<string, string | string[] | undefined>): void {
    if (askId !== this.askState.id) return;
    const response: AskResponse = {};
    for (const [key, label] of Object.entries(this.askState.questionMap)) {
      const val = answers[key];
      if (val !== undefined) response[label] = val;
    }
    this.askState.response = response;
    this.askState.status = "done";
  }
}
