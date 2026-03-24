import { generateReqId } from '@wecom/aibot-node-sdk';
import type { WsFrame } from '@wecom/aibot-node-sdk';
import { AgentMessage, MessageChunkType, GlobalLoggerService } from 'scorpio.ai';
import {
  parseMessages2Text,
  ProviderMessage,
  ProviderMessageType,
  ProviderTextMessage,
  ProviderToolMessage,
} from 'channel.base';
import type { WecomService } from './WecomService';

export { ProviderMessageType, ProviderTextMessage, ProviderToolMessage, ProviderMessage } from 'channel.base';

const getLogger = () => GlobalLoggerService.getLogger('WecomChatProvider.ts');

export class WecomChatProvider {
  private streamId: string;
  private messages: ProviderMessage[] = [];
  private streamMessage: ProviderTextMessage | undefined;
  private tools: Record<string, ProviderToolMessage> = {};
  private finished = false;

  constructor(private service: WecomService, private frame: WsFrame | null, private chatid?: string) {
    this.streamId = generateReqId('stream');
  }

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
    await this.updateStream(false);
  }

  async setStreamMessage(content: string): Promise<void> {
    this.streamMessage = { type: ProviderMessageType.TEXT, content };
    await this.updateStream(false);
  }

  async resetStreamMessage(): Promise<void> {
    this.streamMessage = undefined;
  }

  async setMessage(content: string): Promise<void> {
    this.messages = [{ type: ProviderMessageType.TEXT, content }];
    await this.updateStream(false);
  }

  /** Call when AI response is complete — sends finish=true to close the stream */
  async finish(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    const text = this.buildText();
    try {
      if (this.frame) {
        await this.service.replyStream(this.frame, this.streamId, text, true);
      } else if (this.chatid) {
        await this.service.sendMessage(this.chatid, { msgtype: 'markdown', markdown: { content: text } });
      }
    } catch (e: any) {
      getLogger()?.error(`finish stream error: ${e.message}`, e.stack);
    }
  }

  private buildText(): string {
    const msgs = this.streamMessage ? [...this.messages, this.streamMessage] : this.messages;
    return parseMessages2Text(msgs);
  }

  private async updateStream(finish: boolean): Promise<void> {
    if (this.finished || !this.frame) return;
    const text = this.buildText();
    try {
      await this.service.replyStream(this.frame, this.streamId, text, finish);
    } catch (e: any) {
      getLogger()?.error(`updateStream error: ${e.message}`, e.stack);
    }
  }
}
