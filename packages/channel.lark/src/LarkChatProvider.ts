import { LarkService, LarkReceiveIdType } from "./LarkService";
import { AgentMessage, MessageChunkType } from "scorpio.ai";
import { GlobalLoggerService } from "scorpio.ai";
import { parseMessages2Text, ProviderMessage, ProviderMessageType, ProviderTextMessage, ProviderToolMessage } from "channel.base";

export { ProviderMessageType, ProviderTextMessage, ProviderToolMessage, ProviderMessage } from "channel.base";

const getLogger = () => GlobalLoggerService.getLogger("LarkChatProvider.ts");

export class LarkChatProvider {
  messageId: string | null = null;
  messages: ProviderMessage[] = [];
  streamMessage: ProviderTextMessage | undefined;
  header: any | undefined;
  elements: any[] = [];
  tools: Record<string, ProviderToolMessage> = {};

  constructor(private larkService: LarkService) {}

  async initReplay(messageId: string) {
    const resp: any = await this.larkService.replayMarkdownMessage(messageId, `Thinking...`);
    this.messageId = resp?.message_id ?? null;
    return this;
  }
  async initChat(receiveIdType: LarkReceiveIdType, receiveId: string, query?: string) {
    const initialText = query ? `${query}\nThinking...` : `Processing...`;
    const resp: any = await this.larkService.sendMarkdownMessage(receiveIdType, receiveId, initialText);
    this.messageId = resp?.message_id ?? null;
    return this;
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
  async setMessage(content: string) {
    this.messages = [{ type: ProviderMessageType.TEXT, content: content }];
    await this.updateMessage()
  }
  async setStreamMessage(content: string) {
    this.streamMessage = { type: ProviderMessageType.TEXT, content: content }
    await this.updateMessage()
  }
  async resetStreamMessage() {
    this.streamMessage = undefined
  }
  async deleteElement(...element_id: string[]) {
    for (let id of element_id) {
      for (let i = 0; i < this.elements.length; i++) {
        if (this.elements[i].element_id == id) {
          this.elements.splice(i, 1);
          break
        }
      }
    }
    await this.updateCardMessage()
  }
  async insertElement(index: number | undefined, ...elements: any[]) {
    for (let element of elements) {
      let find = false
      for (let i = 0; i < this.elements.length; i++) {
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
      content: parseMessages2Text(messages),
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
