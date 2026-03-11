import { LarkService, LarkReceiveIdType } from "./LarkService";
import { AgentMessage, MessageChunkType, MCPToolResult, MCPContentType, isMCPToolResult } from "scorpio.ai";
import { GlobalLoggerService } from "scorpio.ai";
import { parseJson } from "scorpio.ai";

const getLogger = () => GlobalLoggerService.getLogger("LarkChatProvider.ts");

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
  args: Record<string, any>;
  result?: boolean;
  status?: string;
  response?: string;
};

export type ProviderMessage = ProviderTextMessage | ProviderToolMessage;

export class LarkChatProvider {
  messageId: string | null = null;
  messages: ProviderMessage[] = [];
  streamMessage: ProviderTextMessage | undefined;
  header: any|undefined;
  elements: any[] = [];
  tools: Record<string, ProviderToolMessage> = {};

  constructor(private larkService: LarkService) {}

  async initReplay(messageId: string) {
    const resp: any = await this.larkService.replayMarkdownMessage(messageId, `思考中... / Thinking...`);
    this.messageId = resp?.message_id ?? null;
    return this;
  }
  async initChat(receiveIdType: LarkReceiveIdType, receiveId: string, query?: string) {
    const initialText = query ? `${query}\n思考中... / Thinking...` : `开始处理...`;
    const resp: any = await this.larkService.sendMarkdownMessage(receiveIdType, receiveId, initialText);
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
          let escapedResponse = ''
          const response = parseJson<MCPToolResult>(message.response!, undefined);
          if (isMCPToolResult(response)) {
            const parts: string[] = [];
            for (const c of response.content) {
              if (c.type === MCPContentType.Text) {
                parts.push(`------${c.type}------\n${c.text}`);
              } else if (c.type === MCPContentType.Image) {
                parts.push(`------${c.type}------\n[image:${c.mimeType}]`);
              } else if (c.type === MCPContentType.Audio) {
                parts.push(`------${c.type}------\n[audio:${c.mimeType}]`);
              } else {
                parts.push(`------${c.type}------\n${JSON.stringify(c)}`);
              }
            }
            escapedResponse = parts.join("\n");
          } else {
            escapedResponse = String(response)
          }
          escapedResponse = escapedResponse.replace(/`/g, '\\`');
          content += `\n返回值:\n${escapedResponse}`;
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
  async addTextMessage(content: string) {
    this.messages.push({ type: ProviderMessageType.TEXT, content });
    await this.updateMessage();
  }
  async setMessage(content:string) {
    this.messages = [{ type: ProviderMessageType.TEXT, content: content }];
    await this.updateMessage()
  }
  async setStreamMessage(content:string) {
    this.streamMessage = {type: ProviderMessageType.TEXT, content: content}
    await this.updateMessage()
  }
  async resetStreamMessage() {
    this.streamMessage = undefined
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
    await this.updateCardMessage()
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
    await this.updateCardMessage()
  }
  private async updateMessage() {
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
  private async updateCardMessage() {
    try {
      if (this.messageId) {
        this.larkService.updateCardMessage(this.messageId, this.elements, this.header);
      }
    } catch (e: any) {
      getLogger()?.error(`updateCardMessage exception: ${e.message || e}`, e.stack);
    }
  }
}
