import { Util } from "weimingcommons";
import { larkService } from "./LarkService.js";
import { LoggerService } from "../LoggerService.js";
import { AgentMessage, MessageChunkType } from "../Agent/AgentService.js";

const logger = LoggerService.getLogger("LarkChatProvider.ts");

export enum ProviderMessageType {
  TEXT = "text",
  TOOL = "tool"
}

export type ProviderTextMessage = {
  type: ProviderMessageType.TEXT;
  content: string;
};

export type ProviderToolMessage = {
  type: ProviderMessageType.TOOL;
  name: string;
  args: unknown;
  result?: boolean;
  status?: string;
  response?: unknown;
};

export type ProviderMessage = ProviderTextMessage | ProviderToolMessage;

export class LarkChatProvider {
  messageId: string | null = null;
  messages: ProviderMessage[] = [];
  streamMessage: ProviderTextMessage | undefined;
  header: any|undefined;
  elements: any[] = [];
  tools: Record<string, ProviderToolMessage> = {};

  async init(chatId: string, query: string) {
    const resp: any = await larkService.sendMarkdownMessage(chatId, `${query}\n思考中... / Thinking...`);
    this.messageId = resp?.message_id ?? null;
    return this;
  }

  /**
   * 将消息数组转换为 Markdown 格式
   */
  private parseMessages2Markdown(messages: ProviderMessage[]) {
    const result: string[] = [];
    for (const message of messages) {
      if (message.type === ProviderMessageType.TEXT) {
        result.push(message.content);
      } else if (message.type === ProviderMessageType.TOOL) {
        let content = `
\`\`\`
调用:${message.name}参数:
${JSON.stringify(message.args, null, 2)}`;
        if (message.result) {
          // 截断过长的工具响应内容（飞书消息有长度限制）
          const MAX_TOOL_RESPONSE_LENGTH = 128;
          let response = String(message.response);
          if (response.length > MAX_TOOL_RESPONSE_LENGTH) {
            response = response.substring(0, MAX_TOOL_RESPONSE_LENGTH) +
                       `\n\n...\n[内容过长，已截断。原始长度: ${response.length} 字符]`;
          }
          const escapedResponse = response.replace(/`/g, '\\`');
          content += `
返回值:
${escapedResponse}`;
        } else {
          content += `
执行中...`
        }
        content += `
\`\`\`
---`;
        result.push(content);
      }
    }
    return result.join("\n\n");
  }

  async addAIMessage(message: AgentMessage) {
    if (message.type === MessageChunkType.AI) {
      if (message.content) {
        this.messages.push({ type: ProviderMessageType.TEXT, content: message.content || "" });
      }
      if (message.tool_calls && message.tool_calls.length > 0) {
        for (const t of message.tool_calls) {
          const toolCall: ProviderToolMessage = { type: ProviderMessageType.TOOL, name: t.name, args: t.args };
          if (t.id) {
            this.tools[t.id] = toolCall;
          }
          this.messages.push(toolCall);
        }
      }
    } else if (message.type === MessageChunkType.TOOL) {
      const toolCall = this.tools[message.tool_call_id || ""];
      if (toolCall) {
        toolCall.result = true;
        toolCall.status = message.status;
        toolCall.response = message.content || "";
      }
    } else if (message.type === MessageChunkType.COMMAND) {
      this.messages.push({ type: ProviderMessageType.TEXT, content: message.content || "" });
    }
    await this.updateMessage()
  }
  async setMessage(content:string) {
    this.messages = [{ type: ProviderMessageType.TEXT, content: content }];
    await this.updateMessage()
  }
  async setStreamMessage(content:string) {
    this.streamMessage = {type: ProviderMessageType.TEXT, content: content}
    await this.updateMessage()
  }
  resetStreamMessage() {
    this.streamMessage = undefined
  }
  async updateMessage() {
    let messages = this.messages
    if (this.streamMessage != undefined) {
      messages = [...this.messages]
      messages.push(this.streamMessage)
    }
    await this.insertElement(0, {
      tag: "markdown",
      element_id: "markdown",
      content: this.parseMessages2Markdown(messages),
      text_align: "left",
      text_size: "normal",
    })
  }
  async deleteElement(...element_id:string[]) {
    for (let id of element_id) {
      for (let i = 0 ; i < this.elements.length; i++) {
        if (this.elements[i].element_id == id) {
          this.elements.splice(i, 1);
          break
        }
      }
    }
    this.updateCardMessage()
  }
  async insertElement(index:number|undefined, ...elements:any[]) {
    for (let element of elements) {
      let find = false
      for (let i = 0 ; i < this.elements.length; i++) {
        if (this.elements[i].element_id == element.element_id) {
          this.elements[i] = element
          find = true
          break
        }
      }
      if (!find) {
        if (index != undefined) {
          this.elements.splice(index, 0, element);
        } else {
          this.elements.push(element)
        }
      }
    }
    this.updateCardMessage()
  }
  async updateCardMessage() {
    try {
      if (this.messageId) {
        await larkService.updateCardMessage(this.messageId, this.elements, this.header);
      }
    } catch (e: any) {
      logger.error(`updateCardMessage exception: ${e.message || e}`, e.stack);
    }
  }
}
