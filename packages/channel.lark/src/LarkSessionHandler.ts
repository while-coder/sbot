import { LarkChatProvider } from "./LarkChatProvider";
import { LarkChatType, LarkReceiveIdType, LarkService } from "./LarkService";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  ChannelSessionHandler, ToolCallStatus, SessionService, createAskTool, createSendFileTool,
  GlobalLoggerService, AskQuestionType,
  type StructuredToolInterface,
  type ChannelMessageArgs, type ChatMessage, type ChatToolCall, type AskToolParams, type MessageType, type MessageContent,
} from "channel.base";

const getLogger = () => GlobalLoggerService.getLogger('LarkSessionHandler.ts');

const ACTION_TOOL_CALL = 'ToolCall';
const ACTION_ASK_FORM = 'AskForm';
const ACTION_ABORT = 'Abort';

const EL_TOOL_CALL_ALLOW = 'toolCallAllow';
const EL_TOOL_CALL_ALWAYS_ARGS = 'toolCallAlwaysArgs';
const EL_TOOL_CALL_ALWAYS_TOOL = 'toolCallAlwaysTool';
const EL_TOOL_CALL_DENY = 'toolCallDeny';
const EL_ASK_FORM = 'askForm';
const EL_ABORT_BTN = 'abortBtn';

export interface LarkMessageArgs extends ChannelMessageArgs {
  event_id: string;
  chat_type: LarkChatType;
  root_id: string;
  message_id: string;
  message_type?: string;
  mentionBot?: boolean;
  userOpenId?: string;
}

export interface LarkActionArgs {
  event_id: string;
  sessionId: string;
  code: string;
  data: any;
  form_value: any;
}

export class LarkSessionHandler extends ChannelSessionHandler {
  provider: LarkChatProvider | undefined;

  constructor(session: SessionService, private larkService: LarkService) {
    super(session);
  }

  async onProcessStart(query: MessageContent, args: ChannelMessageArgs, _messageType: MessageType): Promise<void> {
    const { sessionId, message_id } = args as LarkMessageArgs;
    if (!message_id) {
      this.provider = await new LarkChatProvider(this.larkService).initChat(LarkReceiveIdType.ChatId, sessionId);
    } else {
      this.provider = await new LarkChatProvider(this.larkService).initReplay(message_id);
    }
    await this.sendAbortButton();
  }

  async onProcessEnd(_query: MessageContent, _args: any, _messageType: MessageType, error?: any): Promise<void> {
    if (error && this.provider) {
      await this.provider.setMessage(`Error generating reply: ${error.message}\n${error.stack}`);
    }
    getLogger()?.info(`onProcessEnd: clearing abort button, query=${JSON.stringify(_query)}, provider=${!!this.provider}`);
    await this.clearAbortButton();
  }

  protected async sendAbortButton(): Promise<void> {
    await this.provider?.insertElement(undefined, {
      tag: "button",
      text: { tag: "plain_text", content: "■ 中断" },
      type: "danger",
      width: "default",
      size: "small",
      confirm: {
        title: { tag: "plain_text", content: "确认中断" },
        text: { tag: "plain_text", content: "确定要中断当前任务吗？" },
      },
      behaviors: [{ type: "callback", value: { code: ACTION_ABORT } }],
      element_id: EL_ABORT_BTN,
    });
  }
  protected async clearAbortButton(): Promise<void> {
    await this.provider?.deleteElement(EL_ABORT_BTN);
  }

  async onStreamMessage(message: ChatMessage, _args: ChannelMessageArgs): Promise<void> {
    await this.provider?.setStreamMessage(message);
  }

  async onChatMessage(message: ChatMessage, args: ChannelMessageArgs): Promise<void> {
    this.provider!.resetStreamMessage();
    await this.provider?.addAIMessage(message);
    await this.sendInlineImages(message, args);
  }

  private async sendInlineImages(message: ChatMessage, args: ChannelMessageArgs): Promise<void> {
    if (!Array.isArray(message.content)) return;
    const { sessionId } = args;
    for (const part of message.content) {
      if (part.type === 'inlineData' && part.inlineData?.data) {
        try {
          const ext = (part.inlineData.mimeType ?? 'image/png').split('/')[1] || 'png';
          const buf = Buffer.from(part.inlineData.data, 'base64');
          await this.larkService.sendFileMessage(LarkReceiveIdType.ChatId, sessionId, buf, `image_${Date.now()}.${ext}`);
        } catch (e: any) {
          getLogger()?.error(`Failed to send inline image: ${e.message}`);
        }
      }
    }
  }

  private buildButton(label: string, type: string, approval: ToolCallStatus, elementId: string, toolCallId: string): object {
    return {
      tag: "button",
      text: { tag: "plain_text", content: label },
      type,
      width: "fill",
      size: "medium",
      behaviors: [{ type: "callback", value: { code: ACTION_TOOL_CALL, data: { id: toolCallId, approval } } }],
      margin: "0px 0px 0px 0px",
      element_id: elementId,
    };
  }

  protected async enterApproval(approvalId: string, remainSec: number, toolCall: ChatToolCall): Promise<void> {
    await this.provider?.insertElement(undefined,
      this.buildButton(`Allow ${toolCall.name}`, "primary_filled", ToolCallStatus.Allow, EL_TOOL_CALL_ALLOW, approvalId),
      this.buildButton(`Always allow ${toolCall.name} (same args)`, "primary", ToolCallStatus.AlwaysArgs, EL_TOOL_CALL_ALWAYS_ARGS, approvalId),
      this.buildButton(`Always allow ${toolCall.name} (all args)`, "primary", ToolCallStatus.AlwaysTool, EL_TOOL_CALL_ALWAYS_TOOL, approvalId),
      this.buildButton(`Deny (${remainSec}s)`, "danger_filled", ToolCallStatus.Deny, EL_TOOL_CALL_DENY, approvalId),
    );
  }

  protected async exitApproval(_approvalId: string): Promise<void> {
    await this.provider?.deleteElement(EL_TOOL_CALL_ALLOW, EL_TOOL_CALL_ALWAYS_ARGS, EL_TOOL_CALL_ALWAYS_TOOL, EL_TOOL_CALL_DENY);
  }

  private buildQuestionRow(label: string, inputElements: object[]): object {
    return {
      tag: 'column_set',
      columns: [
        {
          tag: 'column',
          width: 'weighted',
          weight: 1,
          vertical_align: 'top',
          elements: [{ tag: 'markdown', content: label, text_align: 'left' }],
        },
        {
          tag: 'column',
          width: 'weighted',
          weight: 1,
          vertical_align: 'top',
          elements: inputElements,
        },
      ],
    };
  }

  private buildSelectOptions(values: string[]) {
    return values.map(o => ({ text: { tag: 'plain_text' as const, content: o }, value: o }));
  }

  private buildQuestionElements(q: any, name: string): object[] {
    const placeholder = { tag: 'plain_text', content: '请选择' };
    if (q.type === AskQuestionType.Radio || q.type === AskQuestionType.Checkbox) {
      const isMulti = q.type === AskQuestionType.Checkbox;
      const select = {
        tag: isMulti ? 'multi_select_static' : 'select_static', name, required: false, width: 'default', placeholder,
        options: this.buildSelectOptions(q.options),
        ...(!isMulti && { type: 'default' }),
      };
      return [select, {
        tag: 'input', name: `${name}_custom`, width: 'default', required: false,
        placeholder: { tag: 'plain_text', content: '或在此输入自定义选项' },
      }];
    }
    return [{
      tag: 'input', name, width: 'default', required: true,
      placeholder: { tag: 'plain_text', content: q.placeholder || '请输入' },
    }];
  }

  protected async enterAsk(askId: string, remainSec: number, params: AskToolParams): Promise<void> {
    const formElements = params.questions.map((q, i) =>
      this.buildQuestionRow(q.label, this.buildQuestionElements(q, `${i}`))
    );
    formElements.push({
      tag: 'button',
      name: 'submitBtn',
      text: { tag: 'plain_text', content: `提交 (${remainSec}s)` },
      type: 'primary',
      width: 'default',
      form_action_type: 'submit',
      behaviors: [{ type: 'callback', value: { code: ACTION_ASK_FORM, data: { id: askId } } }],
    });
    await this.provider?.insertElement(undefined, {
      tag: 'form',
      element_id: EL_ASK_FORM,
      name: EL_ASK_FORM,
      padding: '4px 0px 4px 0px',
      margin: '0px 0px 0px 0px',
      elements: formElements,
    });
  }

  protected async exitAsk(_askId: string): Promise<void> {
    await this.provider?.deleteElement(EL_ASK_FORM);
  }

  static readonly ASK_PROMPT = `Ask the user one or more structured questions and wait for their response. Use this tool whenever you need clarification, a decision, or input before proceeding.

Question types:
- radio: single-choice selection from a fixed list (optionally with a custom "Other" option)
- checkbox: multi-choice selection from a fixed list (optionally with a custom "Other" option)
- input: free-text entry with an optional placeholder

Returns a map of question label → answer (string for radio/input, string[] for checkbox).`;
  static readonly SEND_FILE_PROMPT = 'Send a local file to the current Lark conversation. Use this tool to deliver any generated or exported file (documents, archives, reports, images, etc.) directly to the user via Lark.';

  buildAgentTools(args: ChannelMessageArgs): StructuredToolInterface[] {
    const { sessionId, userOpenId } = args as LarkMessageArgs;
    return [
        createAskTool((params: AskToolParams) => this.executeAsk(params), LarkSessionHandler.ASK_PROMPT, [AskQuestionType.Radio, AskQuestionType.Checkbox, AskQuestionType.Input]),
        createSendFileTool(LarkSessionHandler.SEND_FILE_PROMPT, async (filePath: string, fileName: string) => {
            await this.larkService.sendFileMessage(LarkReceiveIdType.ChatId, sessionId, filePath, fileName);
        }),
        new DynamicStructuredTool({
            name: '_get_message_history',
            description: 'Retrieve message history from the current Lark chat. Use this tool to look up previous messages in the conversation for context, reference, or summarization.',
            schema: z.object({
                page_size: z.number().describe('Number of messages to return per page (max 50).'),
                page_token: z.string().optional().describe('Pagination token from a previous call to fetch the next page.'),
            }),
            func: async ({ page_size, page_token }) => {
                const data = await this.larkService.getMessageHistory(sessionId, {
                    sortType: 'ByCreateTimeDesc',
                    pageSize: page_size,
                    pageToken: page_token,
                });
                if (!data) return 'Failed to retrieve message history.';
                const items = data.items ?? [];
                const messagesXml = items.map((m: any) => {
                    const isSelf = userOpenId && m.sender?.id === userOpenId;
                    const senderType = m.sender?.sender_type === 'app' ? 'bot' : 'user';
                    return `<message id="${m.message_id ?? ''}" sender_type="${senderType}" is_self="${!!isSelf}">${m.body?.content ?? ''}</message>`;
                }).join('\n');
                return `<message-history has_more="${!!data.has_more}" page_token="${data.page_token ?? ''}">\n${messagesXml}\n</message-history>`;
            },
        }),
    ];
  }

  async onTriggerAction(args: LarkActionArgs): Promise<any> {
    const { code, data, form_value } = args;
    if (code === ACTION_TOOL_CALL) {
      this.resolveApproval(data.id, data.approval as ToolCallStatus ?? ToolCallStatus.Deny);
      return;
    }
    if (code === ACTION_ASK_FORM) {
      const merged: Record<string, any> = { ...(form_value ?? {}) };
      for (const key of Object.keys(merged)) {
        if (key.endsWith('_custom')) {
          const base = key.slice(0, -'_custom'.length);
          const customVal = typeof merged[key] === 'string' ? merged[key].trim() : '';
          if (customVal) {
            merged[base] = merged[base] instanceof Array
              ? [...merged[base], customVal]
              : customVal;
          }
          delete merged[key];
        }
      }
      this.resolveAsk(data.id, merged);
      return;
    }
    if (code === ACTION_ABORT) {
      this.abort();
      return;
    }
    getLogger()?.warn(`Unhandled card action: ${code}`);
  }
}
