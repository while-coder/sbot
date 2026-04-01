import { LarkService, LarkReceiveIdType } from "./LarkService";
import { AbstractChatProvider, parseMessages2Text, GlobalLoggerService, MessageRole } from "channel.base";

const getLogger = () => GlobalLoggerService.getLogger("LarkChatProvider.ts");

export class LarkChatProvider extends AbstractChatProvider {
  messageId: string | null = null;
  header: any | undefined;
  elements: any[] = [];

  constructor(private larkService: LarkService) {
    super();
  }

  async initReplay(messageId: string) {
    const resp: any = await this.larkService.replyMarkdownMessage(messageId, `Thinking...`);
    this.messageId = resp?.message_id ?? null;
    return this;
  }
  async initChat(receiveIdType: LarkReceiveIdType, receiveId: string, query?: string) {
    const initialText = query ? `${query}\nThinking...` : `Processing...`;
    const resp: any = await this.larkService.sendMarkdownMessage(receiveIdType, receiveId, initialText);
    this.messageId = resp?.message_id ?? null;
    return this;
  }

  addTextMessage(content: string) {
    this.messages.push({ role: MessageRole.AI, content });
    this.onMessagesUpdated();
  }

  deleteElement(...element_id: string[]) {
    for (let id of element_id) {
      for (let i = 0; i < this.elements.length; i++) {
        if (this.elements[i].element_id === id) {
          this.elements.splice(i, 1);
          break
        }
      }
    }
    this.updateCardMessage()
  }
  insertElement(index: number | undefined, ...elements: any[]) {
    for (let element of elements) {
      let find = false
      for (let i = 0; i < this.elements.length; i++) {
        if (this.elements[i].element_id === element.element_id) {
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

  protected async onMessagesUpdated(): Promise<void> {
    const messages = this.getDisplayMessages();
    this.insertElement(0, {
      tag: "markdown",
      element_id: "markdown",
      content: parseMessages2Text(messages),
      text_align: "left",
      text_size: "normal",
    })
  }

  private updateCardMessage() {
    try {
      if (this.messageId) {
        this.larkService.updateCardMessage(this.messageId, this.elements, this.header);
      }
    } catch (e: any) {
      getLogger()?.error(`updateCardMessage exception: ${e.message || e}`, e.stack);
    }
  }
}
