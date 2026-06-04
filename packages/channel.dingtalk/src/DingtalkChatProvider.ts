import { DingtalkService } from './DingtalkService';
import { AbstractChatProvider, parseMessages2Text, GlobalLoggerService } from 'channel.base';

const getLogger = () => GlobalLoggerService.getLogger('DingtalkChatProvider.ts');

/**
 * 钉钉无法原地编辑普通 markdown 消息（除非走 AI Card），因此 Provider 仅做：
 *   - 在 onProcessStart 时不主动发"Processing..."（避免刷屏）；
 *   - 累积输出，在 onProcessEnd 时一次性 sessionWebhook 发出最终 markdown。
 *
 * 流式过程中并不更新会话——交由调用方 throttle 控制；调用方可显式 flush()。
 */
export class DingtalkChatProvider extends AbstractChatProvider {
  private sessionId = '';
  private sent = false;
  private atUsers: string[] = [];

  constructor(private dingtalkService: DingtalkService) {
    super();
  }

  init(sessionId: string, atUsers?: string[]): this {
    this.sessionId = sessionId;
    this.atUsers = atUsers ?? [];
    return this;
  }

  /** 立即把当前累积内容作为最终消息发送一次（幂等） */
  async flush(): Promise<void> {
    if (this.sent || !this.sessionId) return;
    this.sent = true;
    try {
      const text = parseMessages2Text(this.getDisplayMessages()).trim();
      if (!text) return;
      await this.dingtalkService.sendMarkdown(this.sessionId, text, this.atUsers);
    } catch (e: any) {
      getLogger()?.error(`flush exception: ${e.message || e}`, e.stack);
    }
  }

  protected onMessagesUpdated(): void {
    // 累积阶段不发送，等 flush
  }
}
