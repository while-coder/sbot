import { TemplateCardType } from '@wecom/aibot-node-sdk';
import type { WsFrame } from '@wecom/aibot-node-sdk';
import {
  AgentMessage,
  AgentToolCall,
  AskToolParams,
  AskQuestionType,
  type RadioQuestion,
  type CheckboxQuestion,
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
  private _chatid = '';
  private _approvalCardSent = false;
  private _currentAskQuestion: (RadioQuestion | CheckboxQuestion) | null = null;

  async startProcessMessage(_query: string, args: WecomMessageArgs, _messageType: MessageType): Promise<string> {
    const { wecomService, chatid, chattype } = args;
    this.wecomService = wecomService;
    this._chatid = chatid;
    this._approvalCardSent = false;
    this._currentAskQuestion = null;
    this.provider = new WecomChatProvider(wecomService, chatid);
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
      await this.wecomService.sendMessage(this._chatid, {
        msgtype: 'template_card',
        template_card: {
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
        },
      } as any);
    } catch (e: any) {
      getLogger()?.error(`sendApprovalUI error: ${e.message}`, e.stack);
      this._approvalCardSent = false;
    }
  }

  protected async clearApprovalUI(_toolCallId: string): Promise<void> {
    this._approvalCardSent = false;
  }

  // --- Ask Form ---

  protected async sendAskForm(params: AskToolParams, askId: string, remainSec: number): Promise<void> {
    const q = params.questions.find(
      (q): q is RadioQuestion | CheckboxQuestion =>
        q.type === AskQuestionType.Radio || q.type === AskQuestionType.Checkbox,
    );
    if (!q) return;

    this._currentAskQuestion = q;
    const isMulti = q.type === AskQuestionType.Checkbox;
    try {
      await this.wecomService.sendMessage(this._chatid, {
        msgtype: 'template_card',
        template_card: {
          card_type: TemplateCardType.TextNotice,
          main_title: {
            title: params.title ?? q.label,
            desc: params.title ? q.label : undefined,
          },
          task_id: `ask_${askId}`,
          checkbox: {
            question_key: 'q0',
            mode: isMulti ? 1 : 0,
            option_list: q.options.map((opt, i) => ({ id: `opt_${i}`, text: opt, is_checked: false })),
          },
          submit_button: { text: `提交 (${remainSec}s)`, key: `AskSubmit|${askId}` },
        },
      } as any);
    } catch (e: any) {
      getLogger()?.error(`sendAskForm error: ${e.message}`, e.stack);
      this._currentAskQuestion = null;
    }
  }

  protected async clearAskForm(_askId: string): Promise<void> {
    this._currentAskQuestion = null;
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
      this.resolveToolCall(id, statusMap[code] ?? ToolCallStatus.Deny);
      return;
    }

    if (code === 'AskSubmit') {
      const askId = parts[1];
      if (!askId) { getLogger()?.warn(`Ask event missing id: ${eventKey}`); return; }
      const checkboxData = (frame.body as any)?.event?.checkbox_data;
      const selectedItems: Array<{ id: string; is_checked: boolean }> = checkboxData?.selected_items ?? [];
      const selectedIds = selectedItems.filter(item => item.is_checked).map(item => item.id);
      const q = this._currentAskQuestion;
      const answers: Record<string, string | string[]> = {};
      if (q) {
        const selectedTexts = selectedIds.map(id => {
          const idx = parseInt(id.replace('opt_', ''), 10);
          return q.options[idx] ?? id;
        });
        answers['0'] = q.type === AskQuestionType.Checkbox ? selectedTexts : (selectedTexts[0] ?? '');
      }
      this.resolveAskResponse(askId, answers);
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
