import {
  ChannelSessionHandler, SessionService, GlobalLoggerService, ToolApproval, createSendFileTool,
  type StructuredToolInterface,
  type ChatMessage, type ChatToolCall, type AskToolParams, type MessageType,
  type ChannelMessageArgs, type MessageContent,
} from "channel.base";
import { WechatChatProvider } from "./WechatChatProvider";
import type { WechatService, WechatMessageArgs } from "./WechatService";

const getLogger = () => GlobalLoggerService.getLogger("WechatSessionHandler.ts");

export class WechatSessionHandler extends ChannelSessionHandler {
  private provider: WechatChatProvider | undefined;

  constructor(session: SessionService, private wechatService: WechatService) {
    super(session);
  }

  async onProcessStart(_query: MessageContent, args: ChannelMessageArgs, _messageType: MessageType): Promise<void> {
    const fromUserId = (args as WechatMessageArgs).fromUserId ?? args.sessionId;
    this.provider = new WechatChatProvider(this.wechatService, fromUserId);
  }

  async onProcessEnd(_query: MessageContent, _args: ChannelMessageArgs, _messageType: MessageType, error?: any): Promise<void> {
    if (error && this.provider) {
      await this.provider.setMessage(`处理出错: ${error.message}`);
    }
    await this.provider?.finish();
  }

  async onStreamMessage(message: ChatMessage, _args: ChannelMessageArgs): Promise<void> {
    await this.provider?.setStreamMessage(message);
  }

  async onChatMessage(message: ChatMessage, _args: ChannelMessageArgs): Promise<void> {
    if (this.provider) {
      await this.provider.addAIMessage(message);
    }
  }

  // --- Approval: auto-allow (no interactive UI in personal WeChat) ---

  protected async enterApproval(_approvalId: string, _remainSec: number, _toolCall: ChatToolCall): Promise<void> {
    // No interactive card support — auto-allow all tool calls
  }

  /** Override executeApproval to auto-allow since WeChat has no card UI */
  async executeApproval(_toolCall: ChatToolCall): Promise<ToolApproval> {
    return ToolApproval.Allow;
  }

  protected async exitApproval(_approvalId: string): Promise<void> {}

  // --- Ask: not supported for MVP ---

  protected async enterAsk(_askId: string, _remainSec: number, _params: AskToolParams): Promise<void> {}
  protected async exitAsk(_askId: string): Promise<void> {}

  // --- Agent tools ---

  static readonly SEND_FILE_PROMPT = "Send a local file to the current WeChat conversation. Use this tool to deliver any generated or exported file (documents, archives, reports, images, etc.) directly to the user via WeChat.";

  buildAgentTools(args: ChannelMessageArgs): StructuredToolInterface[] {
    const userId = (args as WechatMessageArgs).fromUserId ?? args.sessionId;
    return [
      createSendFileTool(WechatSessionHandler.SEND_FILE_PROMPT, async (filePath: string, fileName: string) => {
        await this.wechatService.sendFileMessage(userId, filePath, fileName);
      }),
    ];
  }
}
