import { AbstractChatProvider, GlobalLoggerService, parseMessages2Text } from 'channel.base';
import type { YuanbaoService } from './YuanbaoService';

const getLogger = () => GlobalLoggerService.getLogger('YuanbaoChatProvider.ts');

export class YuanbaoChatProvider extends AbstractChatProvider {
  private sessionId = '';
  private sent = false;

  constructor(private readonly service: YuanbaoService) {
    super();
  }

  init(sessionId: string): this {
    this.sessionId = sessionId;
    return this;
  }

  async flush(): Promise<void> {
    if (this.sent || !this.sessionId) return;
    this.sent = true;
    try {
      const text = parseMessages2Text(this.getDisplayMessages()).trim();
      if (text) await this.service.sendTextToSession(this.sessionId, text);
    } catch (error: any) {
      getLogger()?.error(`flush exception: ${error?.message ?? error}`, error?.stack);
    }
  }

  protected onMessagesUpdated(): void {
    // 元宝不支持原地编辑；完成后一次性发送。
  }
}
