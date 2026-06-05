import { DingtalkChatProvider } from './DingtalkChatProvider';
import { DingtalkService } from './DingtalkService';
import {
  ChannelSessionHandler, ToolCallStatus, SessionService,
  GlobalLoggerService, ToolApproval,
  type ChannelMessageArgs, type ChatMessage, type ChatToolCall, type AskToolParams, type AskResponse, type MessageType, type MessageContent,
} from 'channel.base';

const getLogger = () => GlobalLoggerService.getLogger('DingtalkSessionHandler.ts');

export interface DingtalkMessageArgs extends ChannelMessageArgs {
  msgId: string;
  conversationId: string;
  conversationType: '1' | '2';
  senderStaffId: string;
  senderNick: string;
  robotCode: string;
  atSenderOnReply: boolean;
}

export interface DingtalkActionArgs {
  sessionId: string;
  /** 业务 code, e.g. ToolCallStatus 值 */
  code: string;
  data?: any;
}

/**
 * DingTalk 标准模式：
 *  - 接收 Stream 推送，回复走 sessionWebhook 单次 markdown；
 *  - 钉钉 Markdown 不支持回调按钮，因此 Ask / Approval 无 UI：
 *    Ask 不向 AI 暴露；Approval 自动放行（与 channel.wechat 一致），避免无限等待卡死。
 */
export class DingtalkSessionHandler extends ChannelSessionHandler {
  provider: DingtalkChatProvider | undefined;

  constructor(session: SessionService, private dingtalkService: DingtalkService) {
    super(session);
  }

  async onProcessStart(_query: MessageContent, args: ChannelMessageArgs, _messageType: MessageType): Promise<void> {
    const { sessionId } = args as DingtalkMessageArgs;
    this.provider = new DingtalkChatProvider(this.dingtalkService).init(sessionId);
  }

  async onProcessEnd(_query: MessageContent, _args: ChannelMessageArgs, _messageType: MessageType, error?: any): Promise<void> {
    if (error && this.provider) {
      this.provider.setMessage(`Error generating reply: ${error.message}`);
    }
    await this.provider?.flush();
  }

  async onStreamMessage(message: ChatMessage, _args: any): Promise<void> {
    this.provider?.setStreamMessage(message);
  }

  async onChatMessage(message: ChatMessage, _args: any): Promise<void> {
    this.provider?.resetStreamMessage();
    this.provider?.addAIMessage(message);
  }

  // --- Approval: auto-allow (no interactive UI in DingTalk markdown mode) ---

  async executeApproval(_toolCall: ChatToolCall): Promise<ToolApproval> {
    return ToolApproval.Allow;
  }

  protected async enterApproval(_approvalId: string, _remainSec: number, _toolCall: ChatToolCall): Promise<void> {}
  protected async exitApproval(_approvalId: string): Promise<void> {}

  // --- Ask: not supported in DingTalk markdown mode ---

  async executeAsk(_params: AskToolParams): Promise<AskResponse> {
    throw new Error('DingTalk channel does not support the ask tool in markdown mode');
  }

  protected async enterAsk(_askId: string, _remainSec: number, _params: AskToolParams): Promise<void> {}
  protected async exitAsk(_askId: string): Promise<void> {}

  async onTriggerAction(args: DingtalkActionArgs): Promise<void> {
    const { code, data } = args;
    if (
      code === ToolCallStatus.Allow ||
      code === ToolCallStatus.AlwaysArgs ||
      code === ToolCallStatus.AlwaysTool ||
      code === ToolCallStatus.Deny
    ) {
      if (data?.id) this.resolveApproval(data.id, code as ToolCallStatus);
      return;
    }
    getLogger()?.warn(`Unhandled Dingtalk action: ${code}`);
  }
}
