import { LarkChatProvider } from "./LarkChatProvider";
import { AgentMessage, AgentToolCall, AskToolParams } from "scorpio.ai";
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

  async startProcessMessage(query: string, args: any): Promise<string> {
    const { larkService, chat_id, root_id, message_id } = args as LarkMessageArgs;
    this.larkService = larkService;
    if (!message_id) {
      this.provider = await new LarkChatProvider(larkService).initChat(LarkReceiveIdType.ChatId, chat_id, query);
      return `Session:${chat_id}`;
    }
    this.provider = await new LarkChatProvider(larkService).initReplay(message_id);
    return `Session:${chat_id},Topic:${root_id},MessageId:${message_id}`;
  }

  async processMessageError(e: any): Promise<void> {
    if (this.provider) {
      await this.provider.setMessage(`Error generating reply: ${e.message}\n${e.stack}`);
    }
  }

  async onAgentStreamMessage(message: AgentMessage): Promise<void> {
    await this.provider?.setStreamMessage(message.content || "");
  }

  async onAgentMessage(message: AgentMessage): Promise<void> {
    this.provider!.resetStreamMessage();
    await this.provider?.addAIMessage(message);
  }

  private buildButton(label: string, type: string, approval: ToolCallStatus, elementId: string): object {
    return {
      tag: "button",
      text: { tag: "plain_text", content: label },
      type,
      width: "fill",
      size: "medium",
      behaviors: [{ type: "callback", value: { code: "ToolCall", data: { id: this.toolCall.id, approval } } }],
      margin: "0px 0px 0px 0px",
      element_id: elementId,
    };
  }

  protected async sendApprovalUI(toolCall: AgentToolCall, remainSec: number): Promise<void> {
    await this.provider?.insertElement(undefined,
      this.buildButton(`Allow ${toolCall.name}`, "primary_filled", ToolCallStatus.Allow, "toolCallAllow"),
      this.buildButton(`Always allow ${toolCall.name} (same args)`, "primary", ToolCallStatus.AlwaysArgs, "toolCallAlwaysArgs"),
      this.buildButton(`Always allow ${toolCall.name} (all args)`, "primary", ToolCallStatus.AlwaysTool, "toolCallAlwaysTool"),
      this.buildButton(`Deny (${remainSec}s)`, "danger_filled", ToolCallStatus.Deny, "toolCallDeny"),
    );
  }

  protected async clearApprovalUI(): Promise<void> {
    await this.provider?.deleteElement("toolCallAllow", "toolCallAlwaysArgs", "toolCallAlwaysTool", "toolCallDeny");
  }

  protected async sendAskForm(
    params: AskToolParams,
    askId: string,
    _questionMap: Record<string, string>
  ): Promise<void> {
    const formElements: any[] = [];
    for (let i = 0; i < params.questions.length; i++) {
      const q = params.questions[i];
      const name = `q_${i}`;
      if (q.type === 'radio') {
        const options = q.options.map((o: string) => ({ text: { tag: 'plain_text', content: o }, value: o }));
        if (q.allowCustom) options.push({ text: { tag: 'plain_text', content: 'Other' }, value: '__custom__' });
        formElements.push({ tag: 'select_static', name, label: { tag: 'plain_text', content: q.label }, options });
      } else if (q.type === 'checkbox') {
        const options = q.options.map((o: string) => ({ text: { tag: 'plain_text', content: o }, value: o }));
        if (q.allowCustom) options.push({ text: { tag: 'plain_text', content: 'Other' }, value: '__custom__' });
        formElements.push({ tag: 'multi_select_static', name, label: { tag: 'plain_text', content: q.label }, options });
      } else {
        formElements.push({
          tag: 'input', name,
          label: { tag: 'plain_text', content: q.label },
          placeholder: q.placeholder ? { tag: 'plain_text', content: q.placeholder } : undefined,
        });
      }
    }
    formElements.push({
      tag: 'button',
      text: { tag: 'plain_text', content: 'Submit' },
      type: 'primary',
      form_action_type: 'submit',
      behaviors: [{ type: 'callback', value: { code: 'AskForm', data: { id: askId } } }],
    });
    await this.provider?.insertElement(undefined, {
      tag: 'form',
      element_id: 'askForm',
      ...(params.title ? { header: { title: { tag: 'plain_text', content: params.title } } } : {}),
      elements: formElements,
    });
  }

  protected async clearAskForm(): Promise<void> {
    await this.provider?.deleteElement('askForm');
  }

  async onTriggerAction(_chatId: string, code: string, data: any, formValue: any): Promise<any> {
    if (code === "ToolCall") {
      if (data.id === this.toolCall.id) {
        this.toolCall.status = data.approval as ToolCallStatus ?? ToolCallStatus.Deny;
      }
      return;
    }
    if (code === "AskForm") {
      this.resolveAskResponse(data.id, formValue ?? {});
      return;
    }
    getLogger()?.warn(`Unhandled card action: ${code}`);
  }
}
