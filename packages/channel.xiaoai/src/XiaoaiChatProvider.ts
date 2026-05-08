import { AbstractChatProvider, parseMessages2Text, GlobalLoggerService } from 'channel.base';
import { speak } from './speaker';
import type { AuthedAccount } from './mi/types';

const getLogger = () => GlobalLoggerService.getLogger('XiaoaiChatProvider');

export class XiaoaiChatProvider extends AbstractChatProvider {
  constructor(
    private account: AuthedAccount,
    private deviceId: string,
    private options: { chunkLimit: number; volume?: number },
  ) {
    super();
  }

  protected async onMessagesUpdated(): Promise<void> {}

  async finish(): Promise<void> {
    const text = parseMessages2Text(this.messages);
    if (!text) return;
    try {
      await speak(this.account, this.deviceId, text, {
        chunkLimit: this.options.chunkLimit,
        volume: this.options.volume,
      });
    } catch (e: any) {
      getLogger()?.error(`TTS finish error: ${e.message}`, e.stack);
    }
  }
}
