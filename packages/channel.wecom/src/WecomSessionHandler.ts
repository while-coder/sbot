import {
  ChannelSessionHandler, SessionService, createSendFileTool,
  type StructuredToolInterface,
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

  // --- Agent tools ---

  static readonly SEND_FILE_PROMPT = 'Send a local file to the current WeCom conversation. Use this tool to deliver any generated or exported file (documents, archives, reports, images, etc.) directly to the user via WeCom.';

  async buildAgentTools(args: ChannelMessageArgs): Promise<StructuredToolInterface[]> {
    const { sessionId } = args;
    return [
      createSendFileTool(WecomSessionHandler.SEND_FILE_PROMPT, async (filePath: string, fileName: string) => {
        await this.wecomService.sendFileMessage(sessionId, filePath, fileName);
      }),
    ];
  }
}
