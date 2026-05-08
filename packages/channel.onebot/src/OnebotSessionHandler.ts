import {
  ChannelSessionHandler, ToolCallStatus, SessionService, createSendFileTool,
  type StructuredToolInterface,
  type ChannelMessageArgs,
  type ChatMessage, type MessageContent, type MessageType,
} from 'channel.base';
import { OnebotChatProvider } from './OnebotChatProvider';
import type { OnebotService, OnebotMessageArgs } from './OnebotService';

export class OnebotSessionHandler extends ChannelSessionHandler {
  protected provider: OnebotChatProvider | undefined;

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

  static readonly SEND_FILE_PROMPT = 'Send a local file to the current OneBot conversation. Use this tool to deliver any generated or exported file directly to the user.';

  buildAgentTools(args: ChannelMessageArgs): StructuredToolInterface[] {
    const { userId, groupId } = args as OnebotMessageArgs;
    return [
      createSendFileTool(OnebotSessionHandler.SEND_FILE_PROMPT, async (filePath: string, fileName: string) => {
        await this.service.sendFileMessage({ userId, groupId }, filePath, fileName);
      }),
    ];
  }
}
