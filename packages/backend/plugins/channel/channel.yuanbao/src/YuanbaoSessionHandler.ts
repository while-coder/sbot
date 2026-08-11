import {
  ChannelSessionHandler, SessionService, formatError,
  type ChannelMessageArgs, type MessageContent, type MessageType,
} from 'channel.base';
import { YuanbaoChatProvider } from './YuanbaoChatProvider';
import type { YuanbaoService } from './YuanbaoService';

export interface YuanbaoMessageArgs extends ChannelMessageArgs {
  msgId: string;
  chatType: 'c2c' | 'group';
  senderId: string;
  senderName: string;
  groupCode?: string;
  groupName?: string;
}

export class YuanbaoSessionHandler extends ChannelSessionHandler<YuanbaoChatProvider> {
  constructor(session: SessionService, private readonly service: YuanbaoService) {
    super(session);
  }

  async onProcessStart(_query: MessageContent, args: ChannelMessageArgs, _messageType: MessageType): Promise<void> {
    const { sessionId } = args as YuanbaoMessageArgs;
    this.provider = new YuanbaoChatProvider(this.service).init(sessionId);
    this.service.startTyping(sessionId);
  }

  async onProcessEnd(_query: MessageContent, args: ChannelMessageArgs, _messageType: MessageType, error?: any): Promise<void> {
    const { sessionId } = args as YuanbaoMessageArgs;
    await this.service.stopTyping(sessionId);
    if (error && this.provider) this.provider.setMessage(`Error generating reply: ${formatError(error)}`);
    await this.provider?.flush();
  }
}
