import { AbstractChatProvider, parseMessages2Text, GlobalLoggerService } from 'channel.base';
import type { WecomService } from './WecomService';


const getLogger = () => GlobalLoggerService.getLogger('WecomChatProvider.ts');

export class WecomChatProvider extends AbstractChatProvider {
  constructor(private service: WecomService, private chatid: string) {
    super();
  }

  protected async onMessagesUpdated(): Promise<void> {
    const msg = this.messages[this.messages.length - 1];
    if (!msg) return;
    const text = parseMessages2Text([msg]);
    if (!text) return;
    try {
      await this.service.sendMessage(this.chatid, { msgtype: 'markdown', markdown: { content: text } });
    } catch (e: any) {
      getLogger()?.error(`sendMessage error: ${e.message}`, e.stack);
    }
  }

  async finish(): Promise<void> {}
}
