import {Util} from "../Util";
import {LarkChatProvider} from "./LarkChatProvider";
import { AgentMessage, AgentToolCall, MCPContentType, MCPToolResult } from "scorpio.ai";
import {UserServiceBase} from "../User/UserServiceBase";
import { GlobalLoggerService } from "scorpio.ai";
import { LarkService, LarkReceiveIdType } from "./LarkService";

const getLogger = () => GlobalLoggerService.getLogger('LarkUserService.ts');

export enum ToolCallStatus {
  None = "none",
  Wait = "wait",
  Ok = "ok",
  Cancel = "cancel",
}

export interface LarkMessageArgs {
  larkService: LarkService;
  chat_type: string;
  chat_id: string;
  root_id: string;
  message_id: string;
  /** 主动发送场景（如计时器），传入 user 表的 userid 代替 message_id */
  chatInfo?: { receiveId: string, receiveIdType: LarkReceiveIdType };
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

interface AskUserState {
  status: ToolCallStatus;
  answer: string;
}

export abstract class LarkUserServiceBase extends UserServiceBase {
  provider: LarkChatProvider | undefined;
  larkService!: LarkService;
  toolCall: ToolCallState = { id: undefined, status: ToolCallStatus.None };
  askUserState: AskUserState = { status: ToolCallStatus.None, answer: '' };

  // 实现基类的抽象方法
  async startProcessMessage(query: string, args: any): Promise<string> {
    const { larkService, chat_type, chat_id, root_id, message_id, chatInfo } = args as LarkMessageArgs;
    this.larkService = larkService;
    if (chatInfo) {
      this.provider = await new LarkChatProvider(larkService).initChat(chatInfo.receiveIdType, chatInfo.receiveId, query);
      return `会话ID:${chatInfo.receiveId},会话类型:${chatInfo.receiveIdType}`;
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
  async executeAgentTool(toolCall: AgentToolCall): Promise<boolean> {
    this.toolCall.id = toolCall.id
    this.toolCall.status = ToolCallStatus.Wait;
    try {
      // 从 config 中获取 toolTimeout 配置，默认 30 秒
      let timeout = 30 * 1000
      let end = Util.NowDate + timeout
      let lastSend = 0
      while (this.toolCall.status == ToolCallStatus.Wait) {
        if (Util.NowDate - lastSend > 300) {
          lastSend = Util.NowDate;
          await this.provider?.insertElement(undefined, {
                "tag": "button",
                "text": {
                  "tag": "plain_text",
                  "content": `允许:${toolCall.name}`
                },
                "type": "primary_filled",
                "width": "fill",
                "size": "medium",
                "behaviors": [
                  {
                    "type": "callback",
                    "value": {
                      code: "ToolCall",
                      data: {
                        id: this.toolCall.id,
                        ok: true
                      }
                    }
                  }
                ],
                "margin": "0px 0px 0px 0px",
                "element_id": "toolCallOK"
              },
              {
                "tag": "button",
                "text": {
                  "tag": "plain_text",
                  "content": `拒绝:${toolCall.name}(${Math.floor((end - Util.NowDate) / 1000)}秒)`
                },
                "type": "danger_filled",
                "width": "fill",
                "size": "medium",
                "behaviors": [
                  {
                    "type": "callback",
                    "value": {
                      code: "ToolCall",
                      data: {
                        id: this.toolCall.id,
                        ok: false
                      }
                    }
                  }
                ],
                "margin": "0px 0px 0px 0px",
                "element_id": "toolCallCancel"
              })
        }
        await Util.sleep(10)
        if (Util.NowDate > end) {
          this.toolCall.status = ToolCallStatus.Cancel
          break
        }
      }
      await this.provider?.deleteElement("toolCallOK", "toolCallCancel")
      // @ts-ignore
      return this.toolCall.status == ToolCallStatus.Ok
    } finally {
      this.toolCall.id = undefined
      this.toolCall.status = ToolCallStatus.None
    }
  }
  async askUser(question: string): Promise<string> {
    this.askUserState.status = ToolCallStatus.Wait;
    this.askUserState.answer = '';
    const timeout = 5 * 60 * 1000;
    const end = Util.NowDate + timeout;

    try {
      await this.provider?.insertElement(undefined,
        {
          tag: "markdown",
          content: question,
          element_id: "askUserQuestion",
        },
        {
          tag: "input",
          name: "answer",
          placeholder: { tag: "plain_text", content: "请输入..." },
          element_id: "askUserInput",
        },
        {
          tag: "button",
          text: { tag: "plain_text", content: "确定" },
          type: "primary_filled",
          width: "fill",
          size: "medium",
          behaviors: [{ type: "callback", value: { code: "AskUser", data: {} } }],
          element_id: "askUserConfirm",
        },
      );

      while (this.askUserState.status === ToolCallStatus.Wait) {
        await Util.sleep(10);
        if (Util.NowDate > end) {
          this.askUserState.status = ToolCallStatus.Cancel;
          break;
        }
      }

      await this.provider?.deleteElement("askUserQuestion", "askUserInput", "askUserConfirm");
      return this.askUserState.answer;
    } finally {
      this.askUserState.status = ToolCallStatus.None;
      this.askUserState.answer = '';
    }
  }
  /**
   * 转换 MCP 格式结果中的图片为飞书图片格式
   */
  async convertImages(result: MCPToolResult): Promise<MCPToolResult> {
    try {
      const convertedResult: MCPToolResult = {
        content: [],
        isError: result.isError,
      };

      for (const item of result.content) {
        if (item.type !== MCPContentType.Image && item.type !== MCPContentType.ImageUrl) {
          convertedResult.content.push(item);
          continue;
        }

        try {
          const imageData = this.extractImageData(item);
          if (imageData.startsWith('http://') || imageData.startsWith('https://')) {
            convertedResult.content.push(item);
            continue;
          }

          const imageKey = await this.larkService.uploadImageToLark(imageData);
          convertedResult.content.push({
            type: MCPContentType.CustomImageUrl,
            url: imageKey
          });
        } catch (error: any) {
          getLogger()?.error(`转换图片失败: ${error.message}`);
          convertedResult.content.push(item);
        }
      }
      return convertedResult;
    } catch (error: any) {
      getLogger()?.error(`MCP 图片转换过程出错: ${error.message}`);
      return result;
    }
  }

  private extractImageData(item: any): string {
    if (item.type === MCPContentType.Image) {
      return item.data;
    }
    const urlField = item.url || item.image_url;
    if (!urlField) {
      throw new Error('图片 URL 字段为空');
    }
    return typeof urlField === 'string' ? urlField : urlField.url;
  }
  async onTriggerAction(_chatId: string, code: string, data: any, _formValue: any): Promise<any> {
    if (code === "ToolCall") {
      // 处理工具调用确认
      if (data.id === this.toolCall.id) {
        this.toolCall.status = data.ok ? ToolCallStatus.Ok : ToolCallStatus.Cancel;
      }
      return;
    }

    if (code === "AskUser") {
      this.askUserState.answer = _formValue?.answer ?? '';
      this.askUserState.status = ToolCallStatus.Ok;
      return;
    }

    // 可以扩展更多的卡片操作处理逻辑
    getLogger()?.warn(`未处理的卡片操作: ${code}`);
  }

}