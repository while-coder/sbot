import { LarkChatProvider } from "./LarkChatProvider";
import { AgentMessage, AgentToolCall, AskToolParams, AskQuestionType, MessageType } from "scorpio.ai";
import { GlobalLoggerService } from "scorpio.ai";
import { LarkReceiveIdType, LarkService } from "./LarkService";
import { ChannelUserServiceBase, ToolCallStatus, SessionManager } from "channel.base";

const getLogger = () => GlobalLoggerService.getLogger('LarkUserService.ts');

const ACTION_TOOL_CALL = 'ToolCall';
const ACTION_ASK_FORM = 'AskForm';
const ACTION_ABORT = 'Abort';

const EL_TOOL_CALL_ALLOW = 'toolCallAllow';
const EL_TOOL_CALL_ALWAYS_ARGS = 'toolCallAlwaysArgs';
const EL_TOOL_CALL_ALWAYS_TOOL = 'toolCallAlwaysTool';
const EL_TOOL_CALL_DENY = 'toolCallDeny';
const EL_ASK_FORM = 'askForm';
const EL_ABORT_BTN = 'abortBtn';

export interface LarkMessageArgs {
  larkService: LarkService;
  event_id: string;
  chat_type: string;
  chat_id: string;
  root_id: string;
  message_id: string;
  message_type?: string;
}

export interface LarkActionArgs {
  event_id: string;
  chat_id: string;
  code: string;
  data: any;
  form_value: any;
}

export abstract class LarkUserServiceBase extends ChannelUserServiceBase {
  provider: LarkChatProvider | undefined;
  larkService!: LarkService;

  constructor(sessionManager: SessionManager, threadId: string) {
    super(sessionManager, threadId);
  }

  async onProcessStart(query: string, args: any, _messageType: MessageType): Promise<void> {
    const { larkService, chat_id, root_id, message_id } = args as LarkMessageArgs;
    this.larkService = larkService;
    if (!message_id) {
      this.provider = await new LarkChatProvider(larkService).initChat(LarkReceiveIdType.ChatId, chat_id, query);
    } else {
      this.provider = await new LarkChatProvider(larkService).initReplay(message_id);
    }
    await this.sendAbortButton();
  }

  async onProcessEnd(_query: string, _args: any, _messageType: MessageType, error?: any): Promise<void> {
    await this.clearAbortButton();
    if (error && this.provider) {
      await this.provider.setMessage(`Error generating reply: ${error.message}\n${error.stack}`);
    }
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

  async onAgentStreamMessage(message: AgentMessage): Promise<void> {
    await this.provider?.setStreamMessage(message.content || "");
  }

  async onAgentMessage(message: AgentMessage): Promise<void> {
    this.provider!.resetStreamMessage();
    await this.provider?.addAIMessage(message);
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

  protected async enterApproval(approvalId: string, remainSec: number, toolCall: AgentToolCall): Promise<void> {
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

  private buildQuestionRow(label: string, inputElement: object): object {
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
          elements: [inputElement],
        },
      ],
    };
  }

  protected async enterAsk(askId: string, remainSec: number, params: AskToolParams): Promise<void> {
    const formElements: any[] = [];
    for (let i = 0; i < params.questions.length; i++) {
      const q = params.questions[i];
      const name = `${i}`;
      if (q.type === AskQuestionType.Radio) {
        const options = q.options.map((o: string) => ({ text: { tag: 'plain_text', content: o }, value: o }));
        if (q.allowCustom) options.push({ text: { tag: 'plain_text', content: 'Other' }, value: '__custom__' });
        formElements.push(this.buildQuestionRow(q.label, {
          tag: 'select_static', name, options, required: true,
          placeholder: { tag: 'plain_text', content: '请选择' },
          type: 'default', width: 'default',
        }));
      } else if (q.type === AskQuestionType.Checkbox) {
        const options = q.options.map((o: string) => ({ text: { tag: 'plain_text', content: o }, value: o }));
        if (q.allowCustom) options.push({ text: { tag: 'plain_text', content: 'Other' }, value: '__custom__' });
        formElements.push(this.buildQuestionRow(q.label, {
          tag: 'multi_select_static', name, options, required: true,
          placeholder: { tag: 'plain_text', content: '请选择' },
          width: 'default',
        }));
      } else if (q.type === AskQuestionType.Toggle) {
        const toggleOptions = [
          { text: { tag: 'plain_text', content: '是' }, value: 'true' },
          { text: { tag: 'plain_text', content: '否' }, value: 'false' },
        ];
        formElements.push(this.buildQuestionRow(q.label, {
          tag: 'select_static', name, options: toggleOptions, required: true,
          placeholder: { tag: 'plain_text', content: '请选择' },
          type: 'default', width: 'default',
          initial_index: (q.default ?? false) ? 0 : 1,
        }));
      } else {
        formElements.push(this.buildQuestionRow(q.label, {
          tag: 'input', name, width: 'default', required: true,
          placeholder: q.placeholder ? { tag: 'plain_text', content: q.placeholder } : { tag: 'plain_text', content: '请输入' },
        }));
      }
    }
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

  async onTriggerAction(args: LarkActionArgs): Promise<any> {
    const { code, data, form_value } = args;
    if (code === ACTION_TOOL_CALL) {
      this.resolveApproval(data.id, data.approval as ToolCallStatus ?? ToolCallStatus.Deny);
      return;
    }
    if (code === ACTION_ASK_FORM) {
      this.resolveAsk(data.id, form_value ?? {});
      return;
    }
    if (code === ACTION_ABORT) {
      this.abort();
      return;
    }
    getLogger()?.warn(`Unhandled card action: ${code}`);
  }
}
