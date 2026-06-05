import {
  ChannelSessionHandler, SessionService,
  type ChannelMessageArgs,
  type MessageContent, type MessageType,
} from 'channel.base';
import { XiaoaiChatProvider } from './XiaoaiChatProvider';
import type { XiaoaiService, XiaoaiMessageArgs } from './XiaoaiService';

export class XiaoaiSessionHandler extends ChannelSessionHandler<XiaoaiChatProvider> {
  constructor(session: SessionService, private service: XiaoaiService) {
    super(session);
  }

  async onProcessStart(_query: MessageContent, args: ChannelMessageArgs, _messageType: MessageType): Promise<void> {
    const { deviceId } = args as XiaoaiMessageArgs;
    const account = this.service.getAuthedAccount();
    if (!account) throw new Error('XiaoAi account not authenticated');

    this.provider = new XiaoaiChatProvider(account, deviceId, {
      chunkLimit: this.service.textChunkLimit,
      volume: this.service.volume,
    });
  }

  async onProcessEnd(_query: MessageContent, _args: ChannelMessageArgs, _messageType: MessageType, error?: any): Promise<void> {
    if (error) {
      this.provider?.setMessage(`处理出错: ${error.message}`);
    }
    await this.provider?.finish();
  }

}
