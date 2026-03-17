import {LarkChatProvider} from "./LarkChatProvider";
import { AgentMessage, AgentToolCall, NowDate, sleep, ToolApproval } from "scorpio.ai";
import { UserServiceBase } from "scorpio.ai";
import { GlobalLoggerService } from "scorpio.ai";
import { LarkReceiveIdType, LarkService } from "./LarkService";

const getLogger = () => GlobalLoggerService.getLogger('LarkUserService.ts');

export enum ToolCallStatus {
  None = "none",
  Wait = "wait",
  Allow = "allow",
  AlwaysArgs = "alwaysArgs",
  AlwaysTool = "alwaysTool",
  Deny = "deny",
}

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

interface ToolCallState {
  id: string | undefined;
  status: ToolCallStatus;
}

export abstract class LarkUserServiceBase extends UserServiceBase {
  provider: LarkChatProvider | undefined;
  larkService!: LarkService;
  toolCall: ToolCallState = { id: undefined, status: ToolCallStatus.None };

  // 实现基类的抽象方法
  async startProcessMessage(query: string, args: any): Promise<string> {
    const { larkService, chat_type, chat_id, root_id, message_id } = args as LarkMessageArgs;
    this.larkService = larkService;
    if (!message_id) {
      this.provider = await new LarkChatProvider(larkService).initChat(LarkReceiveIdType.ChatId, chat_id, query);
      return `会话ID:${chat_id}`;
    }
    this.provider = await new LarkChatProvider(larkService).initReplay(message_id);
    return `会话ID:${chat_id},话题:${root_id},消息ID:${message_id}`
  }
  async processMessageError(e: any): Promise<void> {
    if (this.provider) {
      await this.provider.setMessage(`生成回复时出错: ${e.message}\n${e.stack}`);
    }
  }
  async onAgentStreamMessage(message: AgentMessage): Promise<void> {
    // 从消息块中提取文本内容用于流式显示
    const content = message.content || "";
    await this.provider?.setStreamMessage(content);
  }
  async onAgentMessage(message: AgentMessage): Promise<void> {
    this.provider!.resetStreamMessage();
    await this.provider?.addAIMessage(message)
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
          await this.provider?.insertElement(undefined,
            this.buildButton(`允许 ${toolCall.name}`, "primary_filled", ToolCallStatus.Allow, "toolCallAllow"),
            this.buildButton(`总是允许 ${toolCall.name} (相同参数)`, "primary", ToolCallStatus.AlwaysArgs, "toolCallAlwaysArgs"),
            this.buildButton(`总是允许 ${toolCall.name} (所有参数)`, "primary", ToolCallStatus.AlwaysTool, "toolCallAlwaysTool"),
            this.buildButton(`拒绝 (${Math.floor((end - NowDate()) / 1000)}秒)`, "danger_filled", ToolCallStatus.Deny, "toolCallDeny"),
          );
        }
        await sleep(10);
        if (NowDate() > end) {
          this.toolCall.status = ToolCallStatus.Deny;
          break;
        }
      }
      const status = this.toolCall.status as ToolCallStatus;
      await this.provider?.deleteElement("toolCallAllow", "toolCallAlwaysArgs", "toolCallAlwaysTool", "toolCallDeny");
      const statusToApproval: Partial<Record<ToolCallStatus, ToolApproval>> = {
        [ToolCallStatus.Allow]: ToolApproval.Allow,
        [ToolCallStatus.AlwaysArgs]: ToolApproval.AlwaysArgs,
        [ToolCallStatus.AlwaysTool]: ToolApproval.AlwaysTool,
      };
      return statusToApproval[status] ?? ToolApproval.Deny;
    } finally {
      this.toolCall.id = undefined;
      this.toolCall.status = ToolCallStatus.None;
    }
  }
  async onTriggerAction(_chatId: string, code: string, data: any, _formValue: any): Promise<any> {
    if (code === "ToolCall") {
      // 处理工具调用确认
      if (data.id === this.toolCall.id) {
        this.toolCall.status = data.approval as ToolCallStatus ?? ToolCallStatus.Deny;
      }
      return;
    }

    // 可以扩展更多的卡片操作处理逻辑
    getLogger()?.warn(`未处理的卡片操作: ${code}`);
  }

}