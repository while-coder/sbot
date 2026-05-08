import { AbstractChatProvider, parseMessages2Text, GlobalLoggerService } from 'channel.base';
import type { OnebotService } from './OnebotService';

const getLogger = () => GlobalLoggerService.getLogger('OnebotChatProvider.ts');

export class OnebotChatProvider extends AbstractChatProvider {
  constructor(
    private service: OnebotService,
    private target: { userId?: number; groupId?: number },
  ) {
    super();
  }

  protected async onMessagesUpdated(): Promise<void> {}

  async finish(): Promise<void> {
    const text = parseMessages2Text(this.messages);
    if (!text) return;
    try {
      await this.service.sendTextMessage(this.target, text);
    } catch (e: any) {
      getLogger()?.error(`finish error: ${e.message}`, e.stack);
    }
  }
}
