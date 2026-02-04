import { Util } from "weimingcommons";
import { larkService } from "./LarkService.js";
import log4js from "log4js";

const logger = log4js.getLogger("LarkChatProvider.ts");
export type ProviderTextMessage = {
  type: "text";
  content: string;
};

export type ProviderToolMessage = {
  type: "tool";
  name: string;
  args: unknown;
  result?: boolean;
  status?: string;
  response?: unknown;
};

export type ProviderMessage = ProviderTextMessage | ProviderToolMessage;

function parseMessages2Markdown(messages: ProviderMessage[]) {
  const result: string[] = [];
  for (const message of messages) {
    if (message.type === "text") {
      result.push(message.content);
    } else if (message.type === "tool") {
      let content = `
\`\`\`
调用:${message.name}参数:
${JSON.stringify(message.args, null, 2)}`;
      if (message.result) {
        content += `
返回值:
${message.response}`;
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

export class LarkChatProvider {
  messageId: string | null = null;
  messages: ProviderMessage[] = [];
  streamMessage: ProviderTextMessage | undefined;
  header: any|undefined;
  elements: any[] = [];
  tools: Record<string, ProviderToolMessage> = {};
  lastSendTime = 0;
  sendIndex = 0;

  async init(chatId: string, query: string) {
    const resp: any = await larkService.sendMarkdownMessage(chatId, `${query}\n思考中... / Thinking...`);
    this.messageId = resp?.message_id ?? null;
    return this;
  }
  async setMessage(content:string) {
    this.messages = [{ type: "text", content: content }];
    await this.updateMessage()
  }
  async setStreamMessage(content:string) {
    this.streamMessage = {type: "text", content: content}
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
      content: parseMessages2Markdown(messages),
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
      const index = ++this.sendIndex;
      while (Util.NowDate - this.lastSendTime < 200) {
        await Util.sleep(50);
      }
      if (index === this.sendIndex && this.messageId) {
        this.lastSendTime = Util.NowDate
        await larkService.updateCardMessage(this.messageId, this.elements, this.header);
      }
    } catch (e: any) {
      logger.error(`updateCardMessage exception: ${e.message || e}`, e.stack);
    }
  }
}
