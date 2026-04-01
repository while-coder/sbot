import { GlobalLoggerService } from 'scorpio.ai';
import { AbstractChatProvider, parseMessages2Text } from 'channel.base';
import type { WecomService } from './WecomService';

export { ProviderMessageType, ProviderTextMessage, ProviderToolMessage, ProviderMessage } from 'channel.base';

const getLogger = () => GlobalLoggerService.getLogger('WecomChatProvider.ts');

export class WecomChatProvider extends AbstractChatProvider {
  private finished = false;

  constructor(private service: WecomService, private chatid: string) {
    super();
  }

  protected async onMessagesUpdated(): Promise<void> {
    // WecomChatProvider accumulates messages and sends on finish()
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
