import { SlackChatProvider } from "./SlackChatProvider";
import { AgentMessage, AgentToolCall, AskToolParams, AskQuestionType, MessageType } from "scorpio.ai";
import { GlobalLoggerService } from "scorpio.ai";
import { SlackService } from "./SlackService";
import { ChannelUserServiceBase, ToolCallStatus, SessionManager } from "channel.base";

const getLogger = () => GlobalLoggerService.getLogger("SlackUserServiceBase.ts");

export interface SlackMessageArgs {
  slackService: SlackService;
  eventId: string;
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

  constructor(sessionManager: SessionManager) {
    super(sessionManager);
  }

  async onProcessStart(_threadId: string, query: string, args: any, _messageType: MessageType): Promise<void> {
    const { slackService, channel, ts, threadTs } = args as SlackMessageArgs;
    this.slackService = slackService;
    this.provider = await new SlackChatProvider(slackService).init(channel, ts, threadTs, query);
  }

  async onProcessEnd(_threadId: string, _query: string, _args: any, _messageType: MessageType, error?: any): Promise<void> {
    if (error) {
      getLogger()?.error(error.stack ?? error.message);
      if (this.provider) {
        await this.provider.setMessage(`Error generating reply: ${error.message}`);
      }
    }
  }

  async onAgentStreamMessage(message: AgentMessage): Promise<void> {
    await this.provider?.setStreamMessage(message.content || "");
  }

  async onAgentMessage(message: AgentMessage): Promise<void> {
    this.provider?.resetStreamMessage();
    await this.provider?.addAIMessage(message);
  }

  private buildApprovalBlocks(toolCall: AgentToolCall, id: string, remainSec: number): any[] {
    const makeButton = (text: string, actionId: string, style?: string) => ({
      type: "button",
      text: { type: "plain_text", text },
      action_id: actionId,
      value: JSON.stringify({ id, approval: actionId }),
      ...(style ? { style } : {}),
    });
    return [{
      type: "actions",
      block_id: "toolCallActions",
      elements: [
        makeButton(`Allow ${toolCall.name}`, ToolCallStatus.Allow, "primary"),
        makeButton(`Always allow ${toolCall.name} (same args)`, ToolCallStatus.AlwaysArgs),
        makeButton(`Always allow ${toolCall.name} (all args)`, ToolCallStatus.AlwaysTool),
        makeButton(`Deny (${remainSec}s)`, ToolCallStatus.Deny, "danger"),
      ],
    }];
  }

  protected async enterApproval(approvalId: string, remainSec: number, toolCall: AgentToolCall): Promise<void> {
    await this.provider?.setApprovalBlocks(this.buildApprovalBlocks(toolCall, approvalId, remainSec));
  }

  protected async exitApproval(_approvalId: string): Promise<void> {
    await this.provider?.clearApprovalBlocks();
  }

  protected async enterAsk(askId: string, remainSec: number, params: AskToolParams): Promise<void> {
    const inputBlocks: any[] = [];
    if (params.title) {
      inputBlocks.push({ type: "section", text: { type: "mrkdwn", text: `*${params.title}*` } });
    }
    for (let i = 0; i < params.questions.length; i++) {
      const q = params.questions[i];
      const blockId = `${i}`;
      if (q.type === AskQuestionType.Radio) {
        inputBlocks.push({
          type: "input", block_id: blockId,
          label: { type: "plain_text", text: q.label },
          element: {
            type: "static_select", action_id: blockId,
            placeholder: { type: "plain_text", text: "Select..." },
            options: q.options.map((o: string) => ({ text: { type: "plain_text", text: o }, value: o })),
          },
        });
      } else if (q.type === AskQuestionType.Checkbox) {
        inputBlocks.push({
          type: "input", block_id: blockId,
          label: { type: "plain_text", text: q.label },
          element: {
            type: "multi_static_select", action_id: blockId,
            placeholder: { type: "plain_text", text: "Select..." },
            options: q.options.map((o: string) => ({ text: { type: "plain_text", text: o }, value: o })),
          },
        });
      } else if (q.type === AskQuestionType.Toggle) {
        inputBlocks.push({
          type: "input", block_id: blockId, optional: true,
          label: { type: "plain_text", text: q.label },
          element: {
            type: "checkboxes", action_id: blockId,
            options: [{ text: { type: "plain_text", text: q.label }, value: "true" }],
            ...(q.default ? { initial_options: [{ text: { type: "plain_text", text: q.label }, value: "true" }] } : {}),
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
        text: { type: "plain_text", text: `Submit (${remainSec}s)` },
        style: "primary",
        action_id: `ask_submit_${askId}`,
        value: JSON.stringify({ id: askId }),
      }],
    });
    await this.provider?.setAskBlocks(inputBlocks);
  }

  protected async exitAsk(_askId: string): Promise<void> {
    await this.provider?.clearAskBlocks();
  }

  async onTriggerAction(threadId: string, args: SlackActionArgs): Promise<void> {
    const { actionId, value } = args;

    if (
      actionId === ToolCallStatus.Allow ||
      actionId === ToolCallStatus.AlwaysArgs ||
      actionId === ToolCallStatus.AlwaysTool ||
      actionId === ToolCallStatus.Deny
    ) {
      if (value?.id) this.resolveApproval(threadId, value.id, actionId as ToolCallStatus);
      return;
    }

    if (actionId.startsWith("ask_submit_")) {
      if (value?.id && value?.answers) {
        this.resolveAsk(threadId, value.id, value.answers);
      }
      return;
    }

    getLogger()?.warn(`Unhandled Slack action: ${actionId}`);
  }
}
