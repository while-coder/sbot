import {Util} from "weimingcommons";
import {LarkChatProvider, type ProviderToolMessage} from "./LarkChatProvider";
import {type AgentMessage, MessageChunkType, AgentToolCall} from "../Agent/AgentService";
import {getLogger} from "../logger";
import {UserServiceBase} from "../UserService/UserServiceBase";

const logger = getLogger('LarkUserService.ts');


function parseChunk2Message(provider: LarkChatProvider, message: AgentMessage) {
  if (message.type === MessageChunkType.AI) {
    if (message.tool_calls && message.tool_calls.length > 0) {
      for (const t of message.tool_calls) {
        const toolCall: ProviderToolMessage = { type: "tool", name: t.name, args: t.args };
        if (t.id) {
          provider.tools[t.id] = toolCall;
        }
        provider.messages.push(toolCall);
      }
      if (message.content) {
        provider.messages.push({ type: "text", content: message.content || "" });
      }
    } else {
      provider.messages.push({ type: "text", content: message.content || "" });
    }
  } else if (message.type === MessageChunkType.TOOL) {
    const toolCall = provider.tools[message.tool_call_id || ""];
    if (toolCall) {
      toolCall.result = true;
      toolCall.status = message.status;
      toolCall.response = message.content;
    }
  }
  return provider;
}

interface LarkMessageArgs {
  chat_type: string;
  chatId: string;
}

export class LarkUserService extends UserServiceBase {
  static allUsers = new Map<string, LarkUserService>();
  static getUserAgentService(userId: string): LarkUserService {
    if (LarkUserService.allUsers.has(userId)) {
      return LarkUserService.allUsers.get(userId)!;
    }
    const user = new LarkUserService(userId);
    LarkUserService.allUsers.set(userId, user);
    return user;
  }

  isRunning = false;
  provider: LarkChatProvider | undefined;
  toolCallId: string | undefined;
  toolCallStatus: "none" | "wait" | "ok" | "cancel" = "none";

  constructor(userId: string) {
    super(userId);
  }

  // Lark 特定的接收消息方法
  async onReceiveLarkMessage(chat_type: string, chatId: string, query: string) {
    if (Util.isNullOrEmpty(query)) return;

    const args: LarkMessageArgs = { chat_type, chatId };
    await super.onReceiveMessage(query, args);
  }

  // 实现基类的抽象方法
  async startProcessMessage(query: string, args: any): Promise<void> {
    const { chat_type, chatId } = args as LarkMessageArgs;
    this.isRunning = true;
    this.provider = await new LarkChatProvider().init(chatId, query);
    logger.info(`${this.userId} from (${chat_type} - ${chatId}) 开始处理消息: ${query}`);
  }

  async processMessageError(e: any): Promise<void> {
    const errorMsg = `生成回复时出错: ${e.message}\n${e.stack}`;
    logger.error(errorMsg);
    if (this.provider) {
      await this.provider.setMessage(errorMsg);
    }
    this.isRunning = false;
  }

  async onAgentMessage(message: AgentMessage): Promise<void> {
    parseChunk2Message(this.provider!, message);
    this.provider!.resetStreamMessage();
    await this.provider!.updateMessage();
  }

  async onAgentStreamMessage(message: AgentMessage): Promise<void> {
    // 从消息块中提取文本内容用于流式显示
    const content = message.content || "";
    await this.provider?.setStreamMessage(content);
  }

  async executeAgentTool(toolCall: AgentToolCall): Promise<boolean> {
    this.toolCallId = toolCall.id
    this.toolCallStatus = "wait";
    try {
      // 从 config 中获取 toolTimeout 配置，默认 30 秒
      let timeout = 30 * 1000
      let end = Util.NowDate + timeout
      let lastSend = 0
      while (this.toolCallStatus == "wait") {
        if (Util.NowDate - lastSend > 300) {
          lastSend = Util.NowDate;
          await this.provider?.insertElement(undefined, {
                "tag": "button",
                "text": {
                  "tag": "plain_text",
                  "content": `允许调用:${toolCall.name}`
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
                        id: this.toolCallId,
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
                  "content": `拒绝调用:${toolCall.name}(${Math.floor((end - Util.NowDate) / 1000)}秒)`
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
                        id: this.toolCallId,
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
          this.toolCallStatus = "cancel"
          break
        }
      }
      await this.provider?.deleteElement("toolCallOK", "toolCallCancel")
      // @ts-ignore
      return this.toolCallStatus == `ok`
    } finally {
      this.toolCallId = undefined
      this.toolCallStatus = "none"
    }
  }

  async onTriggerAction(_chatId: string, code: string, data: any, _formValue: any): Promise<any> {
    logger.info(`${this.userId} 触发卡片操作: ${code}`, data);

    if (code === "ToolCall") {
      // 处理工具调用确认
      if (data.id === this.toolCallId) {
        this.toolCallStatus = data.ok ? "ok" : "cancel";
      }
      return;
    }

    // 可以扩展更多的卡片操作处理逻辑
    logger.warn(`未处理的卡片操作: ${code}`);
  }

}
