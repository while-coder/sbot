import { TemplateCardType } from '@wecom/aibot-node-sdk';
import type { WsFrame } from '@wecom/aibot-node-sdk';
import {
  AgentMessage,
  AgentToolCall,
  AskToolParams,
  AskQuestionType,
  MessageType,
  GlobalLoggerService,
} from 'scorpio.ai';
import { ChannelUserServiceBase, ToolCallStatus } from 'channel.base';
import { WecomChatProvider } from './WecomChatProvider';
import type { WecomService, WecomMessageArgs, WecomActionArgs } from './WecomService';

export { ToolCallStatus } from 'channel.base';
export type { WecomMessageArgs, WecomActionArgs } from './WecomService';

const getLogger = () => GlobalLoggerService.getLogger('WecomUserServiceBase.ts');

export abstract class WecomUserServiceBase extends ChannelUserServiceBase {
  protected provider: WecomChatProvider | undefined;
  wecomService!: WecomService;
  protected _currentFrame!: WsFrame;

  private _lastCardEventFrame: WsFrame | null = null;
  private _approvalCardSent = false;

  async startProcessMessage(_query: string, args: WecomMessageArgs, _messageType: MessageType): Promise<string> {
    const { wecomService, chatid, chattype, frame } = args;
    this.wecomService = wecomService;
    this._currentFrame = frame;
    this._approvalCardSent = false;
    this._lastCardEventFrame = null;
    this.provider = new WecomChatProvider(wecomService, frame, chatid);
    return chattype === 'single' ? `Session:${chatid}` : `Session:group:${chatid}`;
  }

  async onMessageProcessed(_args: any, _messageType: MessageType): Promise<void> {
    await this.provider?.finish();
  }

  async processMessageError(e: any, _args: any, _messageType: MessageType): Promise<void> {
    if (this.provider) {
      await this.provider.setMessage(`处理出错: ${e.message}`);
      await this.provider.finish();
    }
  }

  async onAgentMessage(message: AgentMessage): Promise<void> {
    if (this.provider) {
      await this.provider.addAIMessage(message);
    }
  }

  // --- Tool Approval UI ---

  protected async sendApprovalUI(toolCall: AgentToolCall, id: string, remainSec: number): Promise<void> {
    if (this._approvalCardSent) return;
    this._approvalCardSent = true;
    try {
      await this.wecomService.replyTemplateCard(this._currentFrame, {
        card_type: TemplateCardType.ButtonInteraction,
        source: { desc: '工具调用请求', desc_color: 0 },
        main_title: {
          title: `工具调用: ${toolCall.name}`,
          desc: `参数: ${JSON.stringify(toolCall.args ?? {})}`,
        },
        task_id: `approval_${id}`,
        button_list: [
          { text: { type: 'plain_text', content: `允许 (${remainSec}s)` }, style: 1, key: `Allow|${id}` },
          { text: { type: 'plain_text', content: `始终允许 (相同参数)` }, style: 1, key: `AlwaysArgs|${id}` },
          { text: { type: 'plain_text', content: `始终允许 (所有参数)` }, style: 1, key: `AlwaysTool|${id}` },
          { text: { type: 'plain_text', content: `拒绝` }, style: 2, key: `Deny|${id}` },
        ],
      } as any);
    } catch (e: any) {
      getLogger()?.error(`sendApprovalUI error: ${e.message}`, e.stack);
      this._approvalCardSent = false; // allow retry on error
    }
  }

  protected async clearApprovalUI(_toolCallId: string): Promise<void> {
    this._approvalCardSent = false;
    if (!this._lastCardEventFrame) return;
    try {
      await this.wecomService.updateTemplateCard(this._lastCardEventFrame, {
        card_type: TemplateCardType.TextNotice,
        main_title: { title: '已处理工具调用' },
        task_id: `cleared`,
      } as any);
    } catch (e: any) {
      getLogger()?.warn(`clearApprovalUI error: ${e.message}`);
    } finally {
      this._lastCardEventFrame = null;
    }
  }

  // --- Ask Form ---

  protected async sendAskForm(params: AskToolParams, askId: string, remainSec: number): Promise<void> {
    const q = params.questions[0];
    if (!q) return;

    try {
      if (q.type === AskQuestionType.Input) {
        // WeCom does not support text input in cards; send a markdown hint via stream
        await this.wecomService.replyStream(
          this._currentFrame,
          `ask_hint_${askId}`,
          `**${params.title ?? '需要您的输入'}**\n${q.label}\n请回复您的答案（${remainSec}s 内有效）`,
          true,
        );
        return;
      }

      const options: string[] =
        q.type === AskQuestionType.Toggle
          ? ['是', '否']
          : (q.options ?? []);

      await this.wecomService.replyTemplateCard(this._currentFrame, {
        card_type: TemplateCardType.ButtonInteraction,
        source: { desc: `${remainSec}s 内有效`, desc_color: 0 },
        main_title: {
          title: params.title ?? '请选择',
          desc: q.label,
        },
        task_id: `ask_${askId}`,
        button_list: options.map((opt: string) => ({
          text: { type: 'plain_text', content: opt },
          style: 1,
          key: `Ask|${askId}|0|${opt}`,
        })),
      } as any);
    } catch (e: any) {
      getLogger()?.error(`sendAskForm error: ${e.message}`, e.stack);
    }
  }

  protected async clearAskForm(_askId: string): Promise<void> {
    if (!this._lastCardEventFrame) return;
    try {
      await this.wecomService.updateTemplateCard(this._lastCardEventFrame, {
        card_type: TemplateCardType.TextNotice,
        main_title: { title: '已提交' },
        task_id: 'ask_cleared',
      } as any);
    } catch (e: any) {
      getLogger()?.warn(`clearAskForm error: ${e.message}`);
    } finally {
      this._lastCardEventFrame = null;
    }
  }

  // --- Card Event Dispatch ---
  // Called by WecomService's onTriggerAction callback after dispatching to the right user service instance.

  async onTriggerAction(_userId: string, args: WecomActionArgs): Promise<void> {
    const { eventKey, frame } = args;
    const parts = eventKey.split('|');
    const code = parts[0];

    if (code === 'Allow' || code === 'AlwaysArgs' || code === 'AlwaysTool' || code === 'Deny') {
      const id = parts[1];
      if (!id) { getLogger()?.warn(`ToolCall event missing id: ${eventKey}`); return; }
      const statusMap: Partial<Record<string, ToolCallStatus>> = {
        Allow: ToolCallStatus.Allow,
        AlwaysArgs: ToolCallStatus.AlwaysArgs,
        AlwaysTool: ToolCallStatus.AlwaysTool,
        Deny: ToolCallStatus.Deny,
      };
      this._lastCardEventFrame = frame;
      this.resolveToolCall(id, statusMap[code] ?? ToolCallStatus.Deny);
      return;
    }

    if (code === 'Ask') {
      const askId = parts[1];
      const qIndex = parts[2];
      const value = parts.slice(3).join('|');
      if (!askId) { getLogger()?.warn(`Ask event missing askId: ${eventKey}`); return; }
      this._lastCardEventFrame = frame;
      this.resolveAskResponse(askId, { [qIndex]: value });
      return;
    }

    if (code === 'Abort') {
      this.onAbortAction();
      return;
    }

    getLogger()?.warn(`Unhandled card event key: ${eventKey}`);
  }

  /** Override to handle abort action */
  protected onAbortAction(): void {}
}
