import { QqService } from './QqService';
import { AbstractChatProvider, parseMessages2Text, GlobalLoggerService } from 'channel.base';

const getLogger = () => GlobalLoggerService.getLogger('QqChatProvider.ts');

/**
 * QQ 官方 Bot API 不支持 chat.update 之类的"原地编辑"——发出的消息无法修改。
 * 因此 Provider 与 channel.dingtalk 类似：累积输出，到 onProcessEnd 时一次性发出。
 *
 * 同一 msg_id 下 msg_seq 必须自增，QqService 已自动处理。
 */
export class QqChatProvider extends AbstractChatProvider {
  private sessionId = '';
  private sent = false;

  constructor(private qqService: QqService) {
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
      if (!text) return;
      await this.qqService.sendMarkdownOrText(this.sessionId, text);
    } catch (e: any) {
      getLogger()?.error(`flush exception: ${e.message || e}`, e.stack);
    }
  }

  protected onMessagesUpdated(): void {
    // 累积阶段不发送
  }
}
