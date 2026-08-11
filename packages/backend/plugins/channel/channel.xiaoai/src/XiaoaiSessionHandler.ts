import {
  ChannelSessionHandler, SessionService,
  type ChannelMessageArgs,
  type MessageContent, type MessageType,
  formatError,
} from 'channel.base';
import { XiaoaiChatProvider } from './XiaoaiChatProvider';
import type { XiaoaiService } from './XiaoaiService';

export class XiaoaiSessionHandler extends ChannelSessionHandler<XiaoaiChatProvider> {
  constructor(session: SessionService, private service: XiaoaiService) {
    super(session);
  }

  async onProcessStart(_query: MessageContent, args: ChannelMessageArgs, _messageType: MessageType): Promise<void> {
    this.provider = new XiaoaiChatProvider(this.service, args.sessionId);
  }

  async onProcessEnd(_query: MessageContent, _args: ChannelMessageArgs, _messageType: MessageType, error?: any): Promise<void> {
    if (error) {
      this.provider?.setMessage(`处理出错: ${formatError(error)}`);
    }
    await this.provider?.finish();
  }

}
