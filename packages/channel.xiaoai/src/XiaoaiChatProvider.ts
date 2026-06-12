import { AbstractChatProvider, parseMessages2Text, GlobalLoggerService } from 'channel.base';
import type { XiaoaiService } from './XiaoaiService';

const getLogger = () => GlobalLoggerService.getLogger('XiaoaiChatProvider');

export class XiaoaiChatProvider extends AbstractChatProvider {
  constructor(
    private xiaoaiService: XiaoaiService,
    private sessionId: string,
  ) {
    super();
  }

  protected onMessagesUpdated(): void {}

  async finish(): Promise<void> {
    const text = parseMessages2Text(this.messages);
    if (!text) return;
    try {
      await this.xiaoaiService.sendTextToSession(this.sessionId, text);
    } catch (e: any) {
      getLogger()?.error(`TTS finish error: ${e.message}`, e.stack);
    }
  }
}
