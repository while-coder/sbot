import { QqChatProvider } from './QqChatProvider';
import { QqService } from './QqService';
import {
  ChannelSessionHandler, SessionService,
  type ChannelMessageArgs, type MessageType, type MessageContent,
} from 'channel.base';

export interface QqMessageArgs extends ChannelMessageArgs {
  msgId: string;
  chatType: 'c2c' | 'group';
  userOpenId: string;
  groupOpenId?: string;
  atSenderOnReply: boolean;
}

/**
 * QQ 官方 Bot API 标准模式：
 *  - WebSocket Gateway 接收 C2C / GROUP_AT 文本消息；
 *  - 回复走 REST API（/v2/users/.../messages 或 /v2/groups/.../messages），被动回复模式；
 *  - 文本中所有 URL 自动替换为 [链接已省略]（QQ 平台限制）；
 *  - 由于平台不支持卡片按钮 / 表单，Ask 不向 AI 暴露；Approval 不进入交互等待。
 */
export class QqSessionHandler extends ChannelSessionHandler<QqChatProvider> {
  constructor(session: SessionService, private qqService: QqService) {
    super(session);
  }

  async onProcessStart(_query: MessageContent, args: ChannelMessageArgs, _messageType: MessageType): Promise<void> {
    const { sessionId } = args as QqMessageArgs;
    this.provider = new QqChatProvider(this.qqService).init(sessionId);
  }

  async onProcessEnd(_query: MessageContent, _args: ChannelMessageArgs, _messageType: MessageType, error?: any): Promise<void> {
    if (error && this.provider) {
      this.provider.setMessage(`Error generating reply: ${error.message}`);
    }
    await this.provider?.flush();
  }

}
