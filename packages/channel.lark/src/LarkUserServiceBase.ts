import { LarkChatProvider } from "./LarkChatProvider";
import { AgentMessage, AgentToolCall, AskToolParams, AskQuestionType, MessageType } from "scorpio.ai";
import { GlobalLoggerService } from "scorpio.ai";
import { LarkReceiveIdType, LarkService } from "./LarkService";
import { ChannelUserServiceBase, ToolCallStatus } from "channel.base";

const getLogger = () => GlobalLoggerService.getLogger('LarkUserService.ts');

export interface LarkMessageArgs {
  larkService: LarkService;
  chat_type: string;
  chat_id: string;
  root_id: string;
  message_id: string;
}

export interface LarkActionArgs {
  chat_id: string;
  code: string;
  data: any;
  form_value: any;
}

export abstract class LarkUserServiceBase extends ChannelUserServiceBase {
  provider: LarkChatProvider | undefined;
  larkService!: LarkService;

  async startProcessMessage(query: string, args: any, _messageType: MessageType): Promise<string> {
    const { larkService, chat_id, root_id, message_id } = args as LarkMessageArgs;
    this.larkService = larkService;
    if (!message_id) {
      this.provider = await new LarkChatProvider(larkService).initChat(LarkReceiveIdType.ChatId, chat_id, query);
      await this.sendCancelButton();
      return `Session:${chat_id}`;
    }
    this.provider = await new LarkChatProvider(larkService).initReplay(message_id);
    await this.sendCancelButton();
    return `Session:${chat_id},Topic:${root_id},MessageId:${message_id}`;
  }

  async onMessageProcessed(_args: any, _messageType: MessageType): Promise<void> {
    await this.clearCancelButton();
  }

  async processMessageError(e: any, _args: any, _messageType: MessageType): Promise<void> {
    await this.clearCancelButton();
    if (this.provider) {
      await this.provider.setMessage(`Error generating reply: ${e.message}\n${e.stack}`);
    }
  }

  protected async sendCancelButton(): Promise<void> {
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
      behaviors: [{ type: "callback", value: { code: "Cancel" } }],
      element_id: "cancelBtn",
    });
  }

  protected async clearCancelButton(): Promise<void> {
    await this.provider?.deleteElement("cancelBtn");
  }

  /** 子类可覆盖此方法以响应中断操作 */
  protected onCancelAction(): void {}

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
      behaviors: [{ type: "callback", value: { code: "ToolCall", data: { id: toolCallId, approval } } }],
      margin: "0px 0px 0px 0px",
      element_id: elementId,
    };
  }

  protected async sendApprovalUI(toolCall: AgentToolCall, id: string, remainSec: number): Promise<void> {
    await this.provider?.insertElement(undefined,
      this.buildButton(`Allow ${toolCall.name}`, "primary_filled", ToolCallStatus.Allow, "toolCallAllow", id),
      this.buildButton(`Always allow ${toolCall.name} (same args)`, "primary", ToolCallStatus.AlwaysArgs, "toolCallAlwaysArgs", id),
      this.buildButton(`Always allow ${toolCall.name} (all args)`, "primary", ToolCallStatus.AlwaysTool, "toolCallAlwaysTool", id),
      this.buildButton(`Deny (${remainSec}s)`, "danger_filled", ToolCallStatus.Deny, "toolCallDeny", id),
    );
  }

  protected async clearApprovalUI(_toolCallId: string): Promise<void> {
    await this.provider?.deleteElement("toolCallAllow", "toolCallAlwaysArgs", "toolCallAlwaysTool", "toolCallDeny");
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

  protected async sendAskForm(params: AskToolParams, askId: string, remainSec: number): Promise<void> {
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
      tag: 'column_set',
      columns: [
        {
          tag: 'column',
          width: 'auto',
          vertical_align: 'top',
          elements: [{
            tag: 'button',
            name: 'submitBtn',
            text: { tag: 'plain_text', content: `提交 (${remainSec}s)` },
            type: 'primary',
            width: 'default',
            form_action_type: 'submit',
            behaviors: [{ type: 'callback', value: { code: 'AskForm', data: { id: askId } } }],
          }],
        },
        {
          tag: 'column',
          width: 'auto',
          vertical_align: 'top',
          elements: [{
            tag: 'button',
            name: 'cancelBtn',
            text: { tag: 'plain_text', content: '取消' },
            type: 'default',
            width: 'default',
            form_action_type: 'reset',
          }],
        },
      ],
    });
    await this.provider?.insertElement(undefined, {
      tag: 'form',
      element_id: 'askForm',
      name: 'askForm',
      padding: '4px 0px 4px 0px',
      margin: '0px 0px 0px 0px',
      elements: formElements,
    });
  }

  protected async clearAskForm(_askId: string): Promise<void> {
    await this.provider?.deleteElement('askForm');
  }

  async onTriggerAction(_chatId: string, code: string, data: any, formValue: any): Promise<any> {
    if (code === "ToolCall") {
      this.resolveToolCall(data.id, data.approval as ToolCallStatus ?? ToolCallStatus.Deny);
      return;
    }
    if (code === "AskForm") {
      this.resolveAskResponse(data.id, formValue ?? {});
      return;
    }
    if (code === "Cancel") {
      this.onCancelAction();
      return;
    }
    getLogger()?.warn(`Unhandled card action: ${code}`);
  }
}
