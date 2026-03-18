import { SlackChatProvider } from "./SlackChatProvider";
import { AgentMessage, AgentToolCall, AskToolParams } from "scorpio.ai";
import { GlobalLoggerService } from "scorpio.ai";
import { SlackService } from "./SlackService";
import { ChannelUserServiceBase, ToolCallStatus } from "channel.base";

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

export abstract class SlackUserServiceBase extends ChannelUserServiceBase {
  provider: SlackChatProvider | undefined;
  slackService!: SlackService;

  async startProcessMessage(query: string, args: any): Promise<string> {
    const { slackService, channel, ts, threadTs } = args as SlackMessageArgs;
    this.slackService = slackService;
    this.provider = await new SlackChatProvider(slackService).init(channel, ts, threadTs, query);
    return `Slack channel:${channel} ts:${ts}`;
  }

  async processMessageError(e: any): Promise<void> {
    getLogger()?.error(e.stack ?? e.message);
    if (this.provider) {
      await this.provider.setMessage(`Error generating reply: ${e.message}`);
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
    return [{
      type: "actions",
      block_id: "toolCallActions",
      elements: [
        makeButton(`Allow ${toolName}`, ToolCallStatus.Allow, "primary"),
        makeButton(`Always allow ${toolName} (same args)`, ToolCallStatus.AlwaysArgs),
        makeButton(`Always allow ${toolName} (all args)`, ToolCallStatus.AlwaysTool),
        makeButton(`Deny (${remainSec}s)`, ToolCallStatus.Deny, "danger"),
      ],
    }];
  }

  protected async sendApprovalUI(toolCall: AgentToolCall, remainSec: number): Promise<void> {
    await this.provider?.setApprovalBlocks(this.buildApprovalBlocks(toolCall.name, remainSec));
  }

  protected async clearApprovalUI(): Promise<void> {
    await this.provider?.clearApprovalBlocks();
  }

  protected async sendAskForm(
    params: AskToolParams,
    askId: string,
    _questionMap: Record<string, string>
  ): Promise<void> {
    const inputBlocks: any[] = [];
    if (params.title) {
      inputBlocks.push({ type: "section", text: { type: "mrkdwn", text: `*${params.title}*` } });
    }
    for (let i = 0; i < params.questions.length; i++) {
      const q = params.questions[i];
      const blockId = `q_${i}`;
      if (q.type === "radio") {
        inputBlocks.push({
          type: "input", block_id: blockId,
          label: { type: "plain_text", text: q.label },
          element: {
            type: "static_select", action_id: blockId,
            placeholder: { type: "plain_text", text: "Select..." },
            options: q.options.map((o: string) => ({ text: { type: "plain_text", text: o }, value: o })),
          },
        });
      } else if (q.type === "checkbox") {
        inputBlocks.push({
          type: "input", block_id: blockId,
          label: { type: "plain_text", text: q.label },
          element: {
            type: "multi_static_select", action_id: blockId,
            placeholder: { type: "plain_text", text: "Select..." },
            options: q.options.map((o: string) => ({ text: { type: "plain_text", text: o }, value: o })),
          },
        });
      } else {
        inputBlocks.push({
          type: "input", block_id: blockId,
          label: { type: "plain_text", text: q.label },
          element: {
            type: "plain_text_input", action_id: blockId,
            ...(q.placeholder ? { placeholder: { type: "plain_text", text: q.placeholder } } : {}),
          },
        });
      }
    }
    inputBlocks.push({
      type: "actions", block_id: "askSubmit",
      elements: [{
        type: "button",
        text: { type: "plain_text", text: "Submit" },
        style: "primary",
        action_id: `ask_submit_${askId}`,
        value: JSON.stringify({ id: askId }),
      }],
    });
    await this.provider?.setAskBlocks(inputBlocks);
  }

  protected async clearAskForm(): Promise<void> {
    await this.provider?.clearAskBlocks();
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
      if (value?.id && value?.answers) {
        this.resolveAskResponse(value.id, value.answers);
      }
      return;
    }

    getLogger()?.warn(`Unhandled Slack action: ${actionId}`);
  }
}
