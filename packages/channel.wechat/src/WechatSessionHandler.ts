import {
  ChannelSessionHandler, SessionService,
  createSendFileTool,
  type StructuredToolInterface,
  type MessageType,
  type ChannelMessageArgs, type MessageContent,
} from "channel.base";
import { WechatChatProvider } from "./WechatChatProvider";
import type { WechatService, WechatMessageArgs } from "./WechatService";

export class WechatSessionHandler extends ChannelSessionHandler<WechatChatProvider> {
  constructor(session: SessionService, private wechatService: WechatService) {
    super(session);
  }

  async onProcessStart(_query: MessageContent, args: ChannelMessageArgs, _messageType: MessageType): Promise<void> {
    const fromUserId = (args as WechatMessageArgs).fromUserId ?? args.sessionId;
    this.provider = new WechatChatProvider(this.wechatService, fromUserId);
  }

  async onProcessEnd(_query: MessageContent, _args: ChannelMessageArgs, _messageType: MessageType, error?: any): Promise<void> {
    if (error) {
      this.provider?.setMessage(`处理出错: ${error.message}`);
    }
    await this.provider?.finish();
  }

  // --- Agent tools ---

  static readonly SEND_FILE_PROMPT = "Send a local file or image to the current WeChat conversation. Use this tool to deliver any generated or exported file (documents, archives, reports, images, charts, etc.) directly to the user via WeChat.";

  async buildAgentTools(args: ChannelMessageArgs): Promise<StructuredToolInterface[]> {
    const userId = (args as WechatMessageArgs).fromUserId ?? args.sessionId;
    return [
      createSendFileTool(WechatSessionHandler.SEND_FILE_PROMPT, async (filePath: string, fileName: string) => {
        await this.wechatService.sendFileMessage(userId, filePath, fileName);
      }),
    ];
  }
}
