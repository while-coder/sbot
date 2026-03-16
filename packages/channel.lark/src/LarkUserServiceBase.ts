import {LarkChatProvider} from "./LarkChatProvider";
import { AgentMessage, AgentToolCall, MCPContentType, MCPToolResult, NowDate, sleep } from "scorpio.ai";
import { UserServiceBase } from "scorpio.ai";
import { GlobalLoggerService } from "scorpio.ai";
import { LarkReceiveIdType, LarkService } from "./LarkService";

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
  async executeAgentTool(toolCall: AgentToolCall): Promise<boolean> {
    this.toolCall.id = toolCall.id
    this.toolCall.status = ToolCallStatus.Wait;
    try {
      // 从 config 中获取 toolTimeout 配置，默认 30 秒
      let timeout = 30 * 1000
      let end = NowDate() + timeout
      let lastSend = 0
      while (this.toolCall.status == ToolCallStatus.Wait) {
        if (NowDate() - lastSend > 300) {
          lastSend = NowDate();
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
                  "content": `拒绝:${toolCall.name}(${Math.floor((end - NowDate()) / 1000)}秒)`
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
        await sleep(10)
        if (NowDate() > end) {
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

    // 可以扩展更多的卡片操作处理逻辑
    getLogger()?.warn(`未处理的卡片操作: ${code}`);
  }

}