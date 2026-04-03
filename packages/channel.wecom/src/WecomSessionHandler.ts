import {
  ChatMessage,
  MessageType,
} from 'scorpio.ai';
import { ChannelSessionHandler, ToolCallStatus, SessionService, type ChannelMessageArgs, type ChannelToolHelpers } from 'channel.base';
import { WecomChatProvider } from './WecomChatProvider';
import type { WecomService, WecomMessageArgs, WecomActionArgs } from './WecomService';

export { ToolCallStatus } from 'channel.base';
export type { WecomMessageArgs, WecomActionArgs } from './WecomService';

export class WecomSessionHandler extends ChannelSessionHandler {
  protected provider: WecomChatProvider | undefined;

  constructor(session: SessionService, private wecomService: WecomService) {
    super(session);
  }

  async onProcessStart(_query: string, args: ChannelMessageArgs, _messageType: MessageType): Promise<void> {
    const { sessionId } = args;
    this.provider = new WecomChatProvider(this.wecomService, sessionId);
  }

  async onProcessEnd(_query: string, _args: ChannelMessageArgs, _messageType: MessageType, error?: any): Promise<void> {
    if (error && this.provider) {
      await this.provider.setMessage(`处理出错: ${error.message}`);
    }
    await this.provider?.finish();
  }



  async onStreamMessage(_message: ChatMessage, _args: ChannelMessageArgs): Promise<void> {}

  async onChatMessage(message: ChatMessage, _args: any): Promise<void> {
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

  async onTriggerAction(_args: WecomActionArgs): Promise<void> {}

  // --- Agent tools ---

  static readonly SEND_FILE_PROMPT = 'Send a local file to the current WeCom conversation. Use this tool to deliver any generated or exported file (documents, archives, reports, images, etc.) directly to the user via WeCom.';

  buildAgentTools(args: ChannelMessageArgs, helpers: ChannelToolHelpers): any[] {
    const { sessionId } = args;
    return [
      helpers.createSendFileTool(WecomSessionHandler.SEND_FILE_PROMPT, async (filePath, fileName) => {
        await this.wecomService.sendFileMessage(sessionId, filePath, fileName);
      }),
    ];
  }
}
