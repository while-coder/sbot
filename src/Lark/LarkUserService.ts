import {Util} from "weimingcommons";
import {larkService } from "./LarkService";
import {LarkChatProvider, type ProviderToolMessage} from "./LarkChatProvider";
import GraphService, {type LangChainMessageChunk, MessageChunkType} from "../Agent/AgentService";
import {getLogger} from "../logger";

const logger = getLogger('LarkUserService.ts');


function parseChunk2Message(provider: LarkChatProvider, message: LangChainMessageChunk) {
  if (message.type === MessageChunkType.AI) {
    if (message.tool_calls && message.tool_calls.length > 0) {
      for (const t of message.tool_calls) {
        const toolCall: ProviderToolMessage = { type: "tool", name: t.name, args: t.args };
        provider.tools[t.id] = toolCall;
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

interface MessageQueueItem {
  chat_type: string;
  chatId: string;
  query: string;
}

export class LarkUserService {
  static allUsers = new Map<string, LarkUserService>();
  static getUserAgentService(userId: string):LarkUserService {
    if (LarkUserService.allUsers.has(userId)) {
      return LarkUserService.allUsers.get(userId)!;
    }
    const user = new LarkUserService(userId);
    LarkUserService.allUsers.set(userId, user);
    return user;
  }
  isRunning = false;
  private readonly _userId: string;
  agentService: GraphService | undefined;
  provider: LarkChatProvider|undefined;
  toolCallId: string | undefined;
  toolCallStatus:"none"|"wait"|"ok"|"cancel" = "none"
  private messageQueue: MessageQueueItem[] = [];
  private isProcessingQueue = false;

  get userId(): string { return this._userId; }

  constructor(userId: string) {
    this._userId = userId;
  }

  async onReceiveMessage(chat_type: string, chatId: string, query: string) {
    if (Util.isNullOrEmpty(query)) return;

    // 将消息加入队列
    this.messageQueue.push({ chat_type, chatId, query });
    logger.info(`${this.userId} 消息加入队列: ${query} (队列长度: ${this.messageQueue.length})`);

    // 如果没有正在处理队列，启动处理
    if (!this.isProcessingQueue) {
      this.processMessageQueue();
    }
  }

  private async processMessageQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    while (this.messageQueue.length > 0) {
      const messageItem = this.messageQueue.shift()!;
      const { chat_type, chatId, query } = messageItem;

      this.isRunning = true;
      // 每次处理消息时创建新的 agentService
      this.agentService = new GraphService(this.userId);
      this.provider = await new LarkChatProvider().init(chatId, query);
      const provider = this.provider;

      try {
        logger.info(`${this.userId} from (${chat_type} - ${chatId}) 开始处理消息: ${query} (剩余队列: ${this.messageQueue.length})`);
        await this.agentService.stream(
          query,
          this.onMessage.bind(this),
          this.onStreamMessage.bind(this),
          this.executeTool.bind(this)
        );
      } catch (e: any) {
        const errorMsg = `${query}\n生成回复时出错 : ${e.message}\n${e.stack}`;
        logger.error(errorMsg);
        await provider.setMessage(errorMsg);
      } finally {
        this.isRunning = false;
        logger.info(`${this.userId} 消息处理完成: ${query}`);
      }
    }

    this.isProcessingQueue = false;
    logger.info(`${this.userId} 队列处理完成`);
  }
  async onMessage(message: LangChainMessageChunk): Promise<void> {
    parseChunk2Message(this.provider!, message);
    this.provider!.resetStreamMessage()
    await this.provider!.updateMessage()
  }
  async onStreamMessage(message: LangChainMessageChunk): Promise<void> {
    // 从消息块中提取文本内容用于流式显示
    const content = message.content || "";
    await this.provider?.setStreamMessage(content)
  }
  async executeTool(toolCall: {type?: "tool_call", id?: string, name: string, args: Record<string, any>}): Promise<boolean> {
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
