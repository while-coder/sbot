import { DingtalkChatProvider } from './DingtalkChatProvider';
import type { DingtalkConversationType, DingtalkService } from './DingtalkService';
import {
  ChannelSessionHandler, SessionService,
  type ChannelMessageArgs, type MessageType, type MessageContent,
  formatError,
} from 'channel.base';

export interface DingtalkMessageArgs extends ChannelMessageArgs {
  msgId: string;
  conversationId: string;
  conversationType: DingtalkConversationType;
  senderStaffId: string;
  senderNick: string;
}

/**
 * DingTalk 标准模式：
 *  - 接收 Stream 推送，回复走 sessionWebhook 单次 markdown；
 *  - 钉钉 Markdown 不支持回调按钮，因此 Ask / Approval 无 UI：
 *    Ask 不向 AI 暴露；Approval 自动放行（与 channel.wechat 一致），避免无限等待卡死。
 */
export class DingtalkSessionHandler extends ChannelSessionHandler<DingtalkChatProvider> {
  constructor(session: SessionService, private dingtalkService: DingtalkService) {
    super(session);
  }

  async onProcessStart(_query: MessageContent, args: ChannelMessageArgs, _messageType: MessageType): Promise<void> {
    const { sessionId } = args as DingtalkMessageArgs;
    this.provider = new DingtalkChatProvider(this.dingtalkService).init(sessionId);
  }

  async onProcessEnd(_query: MessageContent, _args: ChannelMessageArgs, _messageType: MessageType, error?: any): Promise<void> {
    if (error && this.provider) {
      this.provider.setMessage(`Error generating reply: ${formatError(error)}`);
    }
    await this.provider?.flush();
  }
}
