import {
  ChannelSessionHandler, ToolCallStatus, SessionService,
  type ChannelMessageArgs,
  type ChatMessage, type MessageContent, type MessageType,
} from 'channel.base';
import { XiaoaiChatProvider } from './XiaoaiChatProvider';
import type { XiaoaiService, XiaoaiMessageArgs } from './XiaoaiService';

export class XiaoaiSessionHandler extends ChannelSessionHandler {
  protected provider: XiaoaiChatProvider | undefined;

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
    if (error && this.provider) {
      await this.provider.setMessage(`处理出错: ${error.message}`);
    }
    await this.provider?.finish();
  }

  async onStreamMessage(_message: ChatMessage, _args: ChannelMessageArgs): Promise<void> {}

  async onChatMessage(message: ChatMessage, _args: ChannelMessageArgs): Promise<void> {
    if (this.provider) {
      await this.provider.addAIMessage(message);
    }
  }

  protected async enterApproval(approvalId: string): Promise<void> {
    this.resolveApproval(approvalId, ToolCallStatus.Allow);
  }

  protected async exitApproval(): Promise<void> {}
  protected async enterAsk(): Promise<void> {}
  protected async exitAsk(): Promise<void> {}
}
