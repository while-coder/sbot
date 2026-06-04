import { QqChatProvider } from './QqChatProvider';
import { QqService } from './QqService';
import {
  ChannelSessionHandler, ToolCallStatus, SessionService, createAskTool,
  GlobalLoggerService, AskQuestionType,
  type StructuredToolInterface,
  type ChannelMessageArgs, type ChatMessage, type ChatToolCall, type AskToolParams, type MessageType, type MessageContent,
} from 'channel.base';

const getLogger = () => GlobalLoggerService.getLogger('QqSessionHandler.ts');

export interface QqMessageArgs extends ChannelMessageArgs {
  msgId: string;
  chatType: 'c2c' | 'group';
  userOpenId: string;
  groupOpenId?: string;
  atSenderOnReply: boolean;
}

export interface QqActionArgs {
  sessionId: string;
  /** 业务 code, e.g. ToolCallStatus 值 / "ask_submit" */
  code: string;
  data?: any;
}

/**
 * QQ 官方 Bot API 标准模式：
 *  - WebSocket Gateway 接收 C2C / GROUP_AT 文本消息；
 *  - 回复走 REST API（/v2/users/.../messages 或 /v2/groups/.../messages），被动回复模式；
 *  - 文本中所有 URL 自动替换为 [链接已省略]（QQ 平台限制）；
 *  - 由于平台不支持卡片按钮 / 表单，审批 / Ask 在此模式下没有 UI（会按超时策略处理）。
 */
export class QqSessionHandler extends ChannelSessionHandler {
  provider: QqChatProvider | undefined;

  constructor(session: SessionService, private qqService: QqService) {
    super(session);
  }

  async onProcessStart(_query: MessageContent, args: ChannelMessageArgs, _messageType: MessageType): Promise<void> {
    const { sessionId } = args as QqMessageArgs;
    this.provider = new QqChatProvider(this.qqService).init(sessionId);
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

  protected async enterApproval(_approvalId: string, _remainSec: number, toolCall: ChatToolCall): Promise<void> {
    getLogger()?.info(`QQ approval requested for tool=${toolCall.name} (no button UI; will timeout)`);
  }

  protected async exitApproval(_approvalId: string): Promise<void> {}

  protected async enterAsk(_askId: string, _remainSec: number, _params: AskToolParams): Promise<void> {
    getLogger()?.warn('QQ Ask not supported in text mode');
  }

  protected async exitAsk(_askId: string): Promise<void> {}

  async onTriggerAction(args: QqActionArgs): Promise<void> {
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
    getLogger()?.warn(`Unhandled QQ action: ${code}`);
  }

  static readonly ASK_PROMPT = `Ask the user one or more structured questions and wait for their response. Use this tool whenever you need clarification, a decision, or input before proceeding.

Question types:
- input: free-text entry with an optional placeholder

Returns a map of question label → answer (string).`;

  buildAgentTools(_args: ChannelMessageArgs): StructuredToolInterface[] {
    return [createAskTool(
      (params: AskToolParams) => this.executeAsk(params),
      QqSessionHandler.ASK_PROMPT,
      [AskQuestionType.Input],
    )];
  }
}
