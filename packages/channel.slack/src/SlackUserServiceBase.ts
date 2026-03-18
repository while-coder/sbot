import { SlackChatProvider } from "./SlackChatProvider";
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
import { GlobalLoggerService } from "scorpio.ai";
import { SlackService } from "./SlackService";

const getLogger = () => GlobalLoggerService.getLogger("SlackUserServiceBase.ts");

export interface SlackMessageArgs {
  slackService: SlackService;
  channel: string;
  ts: string;
  threadTs?: string;
}

export interface SlackActionArgs {
  channel: string;
  messageTs: string;
  actionId: string;
  value?: any;
}

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

export abstract class SlackUserServiceBase extends UserServiceBase {
  provider: SlackChatProvider | undefined;
  slackService!: SlackService;
  toolCall: ToolCallState = { id: undefined, status: ToolCallStatus.None };
  private askState: AskState = { id: undefined, status: "wait", questionMap: {} };

  async startProcessMessage(query: string, args: any): Promise<string> {
    const { slackService, channel, ts, threadTs } = args as SlackMessageArgs;
    this.slackService = slackService;
    this.provider = await new SlackChatProvider(slackService).init(channel, ts, threadTs, query);
    return `Slack channel:${channel} ts:${ts}`;
  }

  async processMessageError(e: any): Promise<void> {
    getLogger()?.error(e.stack ?? e.message);
    if (this.provider) {
      await this.provider.setMessage(`生成回复时出错: ${e.message}`);
    }
  }

  async onAgentStreamMessage(message: AgentMessage): Promise<void> {
    await this.provider?.setStreamMessage(message.content || "");
  }

  async onAgentMessage(message: AgentMessage): Promise<void> {
    this.provider?.resetStreamMessage();
    await this.provider?.addAIMessage(message);
  }

  private buildApprovalBlocks(toolName: string, remainSec: number): any[] {
    const makeButton = (text: string, actionId: string, style?: string) => ({
      type: "button",
      text: { type: "plain_text", text },
      action_id: actionId,
      value: JSON.stringify({ id: this.toolCall.id, approval: actionId }),
      ...(style ? { style } : {}),
    });
    return [
      {
        type: "actions",
        block_id: "toolCallActions",
        elements: [
          makeButton(`允许 ${toolName}`, ToolCallStatus.Allow, "primary"),
          makeButton(`总是允许 ${toolName} (相同参数)`, ToolCallStatus.AlwaysArgs),
          makeButton(`总是允许 ${toolName} (所有参数)`, ToolCallStatus.AlwaysTool),
          makeButton(`拒绝 (${remainSec}秒)`, ToolCallStatus.Deny, "danger"),
        ],
      },
    ];
  }

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
          await this.provider?.setApprovalBlocks(
            this.buildApprovalBlocks(toolCall.name, remainSec),
          );
        }
        await sleep(10);
        if (NowDate() > end) {
          this.toolCall.status = ToolCallStatus.Deny;
          break;
        }
      }
      await this.provider?.clearApprovalBlocks();
      const statusToApproval: Partial<Record<ToolCallStatus, ToolApproval>> = {
        [ToolCallStatus.Allow]: ToolApproval.Allow,
        [ToolCallStatus.AlwaysArgs]: ToolApproval.AlwaysArgs,
        [ToolCallStatus.AlwaysTool]: ToolApproval.AlwaysTool,
      };
      return statusToApproval[this.toolCall.status] ?? ToolApproval.Deny;
    } finally {
      this.toolCall.id = undefined;
      this.toolCall.status = ToolCallStatus.None;
    }
  }

  async ask(params: AskToolParams): Promise<AskResponse> {
    const askId = `ask_${Date.now()}`;
    const questionMap: Record<string, string> = {};
    const inputBlocks: any[] = [];

    if (params.title) {
      inputBlocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*${params.title}*` },
      });
    }

    for (let i = 0; i < params.questions.length; i++) {
      const q = params.questions[i];
      const blockId = `q_${i}`;
      questionMap[blockId] = q.label;

      if (q.type === "radio") {
        inputBlocks.push({
          type: "input",
          block_id: blockId,
          label: { type: "plain_text", text: q.label },
          element: {
            type: "static_select",
            action_id: blockId,
            placeholder: { type: "plain_text", text: "选择..." },
            options: q.options.map((o: string) => ({
              text: { type: "plain_text", text: o },
              value: o,
            })),
          },
        });
      } else if (q.type === "checkbox") {
        inputBlocks.push({
          type: "input",
          block_id: blockId,
          label: { type: "plain_text", text: q.label },
          element: {
            type: "multi_static_select",
            action_id: blockId,
            placeholder: { type: "plain_text", text: "选择..." },
            options: q.options.map((o: string) => ({
              text: { type: "plain_text", text: o },
              value: o,
            })),
          },
        });
      } else {
        inputBlocks.push({
          type: "input",
          block_id: blockId,
          label: { type: "plain_text", text: q.label },
          element: {
            type: "plain_text_input",
            action_id: blockId,
            ...(q.placeholder
              ? { placeholder: { type: "plain_text", text: q.placeholder } }
              : {}),
          },
        });
      }
    }

    inputBlocks.push({
      type: "actions",
      block_id: "askSubmit",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "提交" },
          style: "primary",
          action_id: `ask_submit_${askId}`,
          value: JSON.stringify({ id: askId }),
        },
      ],
    });

    this.askState = { id: askId, status: "wait", questionMap };
    await this.provider?.setAskBlocks(inputBlocks);

    const end = NowDate() + 5 * 60 * 1000;
    while (this.askState.status === "wait") {
      await sleep(10);
      if (NowDate() > end) {
        this.askState.status = "timeout";
        break;
      }
    }

    await this.provider?.clearAskBlocks();
    const { status, response } = this.askState;
    this.askState = { id: undefined, status: "wait", questionMap: {} };

    if (status !== "done" || !response)
      throw new Error("User did not answer within the allotted time");
    return response;
  }

  async onTriggerAction(args: SlackActionArgs): Promise<void> {
    const { actionId, value } = args;

    if (
      actionId === ToolCallStatus.Allow ||
      actionId === ToolCallStatus.AlwaysArgs ||
      actionId === ToolCallStatus.AlwaysTool ||
      actionId === ToolCallStatus.Deny
    ) {
      if (value?.id === this.toolCall.id) {
        this.toolCall.status = actionId as ToolCallStatus;
      }
      return;
    }

    if (actionId.startsWith("ask_submit_")) {
      if (value?.id !== this.askState.id) return;
      if (value?.answers) {
        const response: AskResponse = {};
        for (const [blockId, label] of Object.entries(this.askState.questionMap)) {
          const val = value.answers[blockId];
          if (val !== undefined) response[label] = val;
        }
        this.askState.response = response;
        this.askState.status = "done";
      }
      return;
    }

    getLogger()?.warn(`Unhandled Slack action: ${actionId}`);
  }
}
