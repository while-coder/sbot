import { ChatMessage, MessageRole } from "scorpio.ai";

export abstract class AbstractChatProvider {
  protected messages: ChatMessage[] = [];
  protected streamMessage: ChatMessage | undefined;

  async addAIMessage(message: ChatMessage): Promise<void> {
    this.messages.push(message);
    await this.onMessagesUpdated();
  }

  async setMessage(content: string): Promise<void> {
    this.messages = [{ role: MessageRole.AI, content }];
    await this.onMessagesUpdated();
  }

  async setStreamMessage(message: ChatMessage): Promise<void> {
    this.streamMessage = message;
    await this.onMessagesUpdated();
  }

  resetStreamMessage(): void {
    this.streamMessage = undefined;
  }

  protected getDisplayMessages(): ChatMessage[] {
    if (this.streamMessage) {
      return [...this.messages, this.streamMessage];
    }
    return this.messages;
  }

  protected abstract onMessagesUpdated(): Promise<void>;
}
