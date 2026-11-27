import {
  ChannelSessionHandler, SessionService,
  type ChannelMessageArgs,
  type MessageContent, type MessageType,
  formatError,
} from 'channel.base';
import { WecomChatProvider } from './WecomChatProvider';
import type { WecomService, WecomMessageArgs, WecomActionArgs } from './WecomService';

export { ToolCallStatus } from 'channel.base';
export type { WecomMessageArgs, WecomActionArgs } from './WecomService';

export class WecomSessionHandler extends ChannelSessionHandler<WecomChatProvider> {
  constructor(session: SessionService, private wecomService: WecomService) {
    super(session);
  }

  async onProcessStart(_query: MessageContent, args: ChannelMessageArgs, _messageType: MessageType): Promise<void> {
    const { sessionId } = args;
    this.provider = new WecomChatProvider(this.wecomService, sessionId);
  }

  async onProcessEnd(_query: MessageContent, _args: ChannelMessageArgs, _messageType: MessageType, error?: any): Promise<void> {
    if (error) {
      this.provider?.setMessage(`处理出错: ${formatError(error)}`);
    }
    await this.provider?.finish();
  }

  async onTriggerAction(_args: WecomActionArgs): Promise<void> {}

}
