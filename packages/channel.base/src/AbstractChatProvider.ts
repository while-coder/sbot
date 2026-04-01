import { AgentMessage, MessageChunkType } from "scorpio.ai";
import { ProviderMessage, ProviderMessageType, ProviderTextMessage, ProviderToolMessage } from "./ProviderMessage";

export abstract class AbstractChatProvider {
  protected messages: ProviderMessage[] = [];
  protected streamMessage: ProviderTextMessage | undefined;
  protected tools: Record<string, ProviderToolMessage> = {};

  async addAIMessage(message: AgentMessage): Promise<void> {
    if (message.type === MessageChunkType.AI) {
      if (message.content) {
        this.messages.push({ type: ProviderMessageType.TEXT, content: message.content });
      }
      if (message.tool_calls?.length) {
        for (const t of message.tool_calls) {
          const toolMsg: ProviderToolMessage = { type: ProviderMessageType.TOOL, name: t.name, args: t.args };
          if (t.id) this.tools[t.id] = toolMsg;
          this.messages.push(toolMsg);
        }
      }
    } else if (message.type === MessageChunkType.TOOL) {
      const toolMsg = this.tools[message.tool_call_id ?? ''];
      if (toolMsg) {
        toolMsg.result = true;
        toolMsg.status = message.status;
        toolMsg.response = message.content ?? '';
      }
    } else if (message.type === MessageChunkType.COMMAND) {
      this.messages.push({ type: ProviderMessageType.TEXT, content: message.content ?? '' });
    }
    await this.onMessagesUpdated();
  }

  async setMessage(content: string): Promise<void> {
    this.messages = [{ type: ProviderMessageType.TEXT, content }];
    await this.onMessagesUpdated();
  }

  async setStreamMessage(content: string): Promise<void> {
    this.streamMessage = { type: ProviderMessageType.TEXT, content };
    await this.onMessagesUpdated();
  }

  resetStreamMessage(): void {
    this.streamMessage = undefined;
  }

  protected getDisplayMessages(): ProviderMessage[] {
    if (this.streamMessage) {
      return [...this.messages, this.streamMessage];
    }
    return this.messages;
  }

  protected abstract onMessagesUpdated(): Promise<void>;
}
