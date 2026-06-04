import { DingtalkChatProvider } from './DingtalkChatProvider';
import { DingtalkService } from './DingtalkService';
import {
  ChannelSessionHandler, ToolCallStatus, SessionService, createAskTool,
  GlobalLoggerService, AskQuestionType,
  type StructuredToolInterface,
  type ChannelMessageArgs, type ChatMessage, type ChatToolCall, type AskToolParams, type MessageType, type MessageContent,
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
  /** 业务 code, e.g. ToolCallStatus 值 / "ask_submit" */
  code: string;
  data?: any;
}

/**
 * DingTalk 标准模式：
 *  - 接收 Stream 推送，回复走 sessionWebhook 单次 markdown；
 *  - 审批 / Ask 暂以"无按钮"方式工作（钉钉 Markdown 不支持回调按钮，需 AI Card 模板）。
 *    如需交互，需切换 AI Card 模式或额外接入 webhook 接收 ActionCard 跳转回调。
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

  protected async enterApproval(_approvalId: string, _remainSec: number, toolCall: ChatToolCall): Promise<void> {
    // 无按钮支持：直接告知用户工具请求，超时按 approvalTimeoutValue 处理
    getLogger()?.info(`Dingtalk approval requested for tool=${toolCall.name} (no button UI; will timeout)`);
  }

  protected async exitApproval(_approvalId: string): Promise<void> {
    // 无 UI 元素需要清理
  }

  protected async enterAsk(_askId: string, _remainSec: number, _params: AskToolParams): Promise<void> {
    // 无按钮支持：Ask 在钉钉 markdown 模式下不可交互
    getLogger()?.warn('Dingtalk Ask not supported in markdown mode');
  }

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
    if (code === 'ask_submit' && data?.id) {
      this.resolveAsk(data.id, data.answers ?? {});
      return;
    }
    getLogger()?.warn(`Unhandled Dingtalk action: ${code}`);
  }

  static readonly ASK_PROMPT = `Ask the user one or more structured questions and wait for their response. Use this tool whenever you need clarification, a decision, or input before proceeding.

Question types:
- radio: single-choice selection from a fixed list (optionally with a custom "Other" option)
- checkbox: multi-choice selection from a fixed list (optionally with a custom "Other" option)
- input: free-text entry with an optional placeholder

Returns a map of question label → answer (string for radio/input, string[] for checkbox).`;

  buildAgentTools(_args: ChannelMessageArgs): StructuredToolInterface[] {
    return [createAskTool(
      (params: AskToolParams) => this.executeAsk(params),
      DingtalkSessionHandler.ASK_PROMPT,
      [AskQuestionType.Input],
    )];
  }
}
