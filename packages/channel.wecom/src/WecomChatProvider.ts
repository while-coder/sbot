import { AgentMessage, MessageChunkType, GlobalLoggerService } from 'scorpio.ai';
import {
  parseMessages2Text,
  ProviderMessage,
  ProviderMessageType,
  ProviderToolMessage,
} from 'channel.base';
import type { WecomService } from './WecomService';

export { ProviderMessageType, ProviderTextMessage, ProviderToolMessage, ProviderMessage } from 'channel.base';

const getLogger = () => GlobalLoggerService.getLogger('WecomChatProvider.ts');

export class WecomChatProvider {
  private messages: ProviderMessage[] = [];
  private tools: Record<string, ProviderToolMessage> = {};
  private finished = false;

  constructor(private service: WecomService, private chatid: string) {}

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
  }

  async setMessage(content: string): Promise<void> {
    this.messages = [{ type: ProviderMessageType.TEXT, content }];
  }

  /** Call when AI response is complete — sends the final result */
  async finish(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    const text = parseMessages2Text(this.messages);
    try {
      await this.service.sendMessage(this.chatid, { msgtype: 'markdown', markdown: { content: text } });
    } catch (e: any) {
      getLogger()?.error(`finish error: ${e.message}`, e.stack);
    }
  }
}
