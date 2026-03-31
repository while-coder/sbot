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
import { ChannelUserServiceBase, ToolCallStatus, SessionManager } from 'channel.base';
import { WecomChatProvider } from './WecomChatProvider';
import type { WecomService, WecomMessageArgs, WecomActionArgs } from './WecomService';

export { ToolCallStatus } from 'channel.base';
export type { WecomMessageArgs, WecomActionArgs } from './WecomService';

const getLogger = () => GlobalLoggerService.getLogger('WecomUserServiceBase.ts');

export abstract class WecomUserServiceBase extends ChannelUserServiceBase {
  protected provider: WecomChatProvider | undefined;
  wecomService!: WecomService;
  private _chatid = '';
  private _currentAskQuestion: (RadioQuestion | CheckboxQuestion) | null = null;

  constructor(sessionManager: SessionManager) {
    super(sessionManager);
  }

  async onProcessStart(_threadId: string, _query: string, args: WecomMessageArgs, _messageType: MessageType): Promise<void> {
    const { wecomService, chatid } = args;
    this.wecomService = wecomService;
    this._chatid = chatid;
    this._currentAskQuestion = null;
    this.provider = new WecomChatProvider(wecomService, chatid);
  }

  async onProcessEnd(_threadId: string, _query: string, _args: any, _messageType: MessageType, error?: any): Promise<void> {
    if (error && this.provider) {
      await this.provider.setMessage(`处理出错: ${error.message}`);
    }
    await this.provider?.finish();
  }



  async onAgentMessage(message: AgentMessage): Promise<void> {
    if (this.provider) {
      await this.provider.addAIMessage(message);
    }
  }

  // --- Tool Approval UI ---

  protected async enterApproval(approvalId: string, remainSec: number, toolCall: AgentToolCall): Promise<void> {
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
          // quote_area: {
          //   title: `工具调用: ${toolCall.name}`,
          //   quote_text: `参数: ${JSON.stringify(toolCall.args ?? {})}`,
          // },
          task_id: `approval_${approvalId}`,
          button_list: [
            { text: `允许 (${remainSec}s)`, style: 1, key: `Allow|${approvalId}` },
            { text: `始终允许 (相同参数)`, style: 1, key: `AlwaysArgs|${approvalId}` },
            { text: `始终允许 (所有参数)`, style: 1, key: `AlwaysTool|${approvalId}` },
            { text: `拒绝`, style: 2, key: `Deny|${approvalId}` },
          ],
          // action_menu: {
          //   desc: "操作类型",
          //   action_list: [
          //     { text: `始终允许 (相同参数)`, style: 1, key: `AlwaysArgs|${id}` },
          //     { text: `始终允许 (所有参数)`, style: 1, key: `AlwaysTool|${id}` },
          //     { text: `拒绝`, style: 2, key: `Deny|${id}` },
          //   ]
          // }
        },
      } as any);
    } catch (e: any) {
      getLogger()?.error(`enterApproval error: ${e.message}`, e.stack);
    }
  }

  protected async exitApproval(_approvalId: string): Promise<void> {}

  // --- Ask Form ---

  protected async enterAsk(askId: string, remainSec: number, params: AskToolParams): Promise<void> {
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
      getLogger()?.error(`enterAsk error: ${e.message}`, e.stack);
      this._currentAskQuestion = null;
    }
  }

  protected async exitAsk(_askId: string): Promise<void> {
    this._currentAskQuestion = null;
  }

  // --- Card Event Dispatch ---
  // Called by WecomService's onTriggerAction callback after dispatching to the right user service instance.

  async onTriggerAction(threadId: string, _userId: string, args: WecomActionArgs): Promise<void> {
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
      this.resolveApproval(threadId, id, statusMap[code] ?? ToolCallStatus.Deny);
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
      this.resolveAsk(threadId, askId, answers);
      return;
    }

    if (code === 'Abort') {
      this.abort(threadId);
      return;
    }

    getLogger()?.warn(`Unhandled card event key: ${eventKey}`);
  }
}
