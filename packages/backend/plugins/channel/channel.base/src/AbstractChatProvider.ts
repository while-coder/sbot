import { ChatMessage, MessageRole } from "scorpio.ai";

export abstract class AbstractChatProvider {
  protected messages: ChatMessage[] = [];
  protected streamMessage: ChatMessage | undefined;

  addAIMessage(message: ChatMessage): void {
    this.messages.push(message);
    this.onMessagesUpdated();
  }

  setMessage(content: string): void {
    this.messages = [{ role: MessageRole.AI, content }];
    this.onMessagesUpdated();
  }

  setStreamMessage(message: ChatMessage): void {
    this.streamMessage = message;
    this.onMessagesUpdated();
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

  protected abstract onMessagesUpdated(): void;
}
