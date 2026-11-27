import {
  ChannelSessionHandler, SessionService,
  type ChannelMessageArgs,
  type MessageContent, type MessageType,
  formatError,
} from 'channel.base';
import { OnebotChatProvider } from './OnebotChatProvider';
import type { OnebotService, OnebotMessageArgs } from './OnebotService';

export class OnebotSessionHandler extends ChannelSessionHandler<OnebotChatProvider> {
  constructor(session: SessionService, private service: OnebotService) {
    super(session);
  }

  async onProcessStart(_query: MessageContent, args: ChannelMessageArgs, _messageType: MessageType): Promise<void> {
    const { userId, groupId } = args as OnebotMessageArgs;
    this.provider = new OnebotChatProvider(this.service, {
      userId,
      groupId,
    });
  }

  async onProcessEnd(_query: MessageContent, _args: ChannelMessageArgs, _messageType: MessageType, error?: any): Promise<void> {
    if (error) {
      this.provider?.setMessage(`处理出错: ${formatError(error)}`);
    }
    await this.provider?.finish();
  }

}
