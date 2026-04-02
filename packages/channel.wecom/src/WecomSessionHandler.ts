import { TemplateCardType } from '@wecom/aibot-node-sdk';
import type { WsFrame } from '@wecom/aibot-node-sdk';
import {
  ChatMessage,
  ChatToolCall,
  MessageType,
  GlobalLoggerService,
} from 'scorpio.ai';
import { ChannelSessionHandler, ToolCallStatus, SessionService, type ChannelMessageArgs } from 'channel.base';
import { WecomChatProvider } from './WecomChatProvider';
import type { WecomService, WecomMessageArgs, WecomActionArgs } from './WecomService';

export { ToolCallStatus } from 'channel.base';
export type { WecomMessageArgs, WecomActionArgs } from './WecomService';

const getLogger = () => GlobalLoggerService.getLogger('WecomSessionHandler.ts');

const EventKey = {
  Allow: 'Allow',
  AlwaysArgs: 'AlwaysArgs',
  AlwaysTool: 'AlwaysTool',
  Deny: 'Deny',
  Abort: 'Abort',
} as const;

export class WecomSessionHandler extends ChannelSessionHandler {
  protected provider: WecomChatProvider | undefined;
  private _chatid = '';
  constructor(session: SessionService, private wecomService: WecomService) {
    super(session);
  }

  async onProcessStart(_query: string, args: ChannelMessageArgs, _messageType: MessageType): Promise<void> {
    const { sessionId } = args;
    this._chatid = sessionId;
    this.provider = new WecomChatProvider(this.wecomService, sessionId);
  }

  async onProcessEnd(_query: string, _args: ChannelMessageArgs, _messageType: MessageType, error?: any): Promise<void> {
    if (error && this.provider) {
      await this.provider.setMessage(`处理出错: ${error.message}`);
    }
    await this.provider?.finish();
  }



  async onStreamMessage(message: ChatMessage, _args: ChannelMessageArgs): Promise<void> {
    await this.provider?.setStreamMessage(message);
  }

  async onChatMessage(message: ChatMessage, _args: any): Promise<void> {
    if (this.provider) {
      await this.provider.addAIMessage(message);
    }
  }

  // --- Tool Approval UI ---

  protected async enterApproval(approvalId: string, remainSec: number, toolCall: ChatToolCall): Promise<void> {
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
          task_id: `approval_${approvalId}`,
          button_list: [
            { text: `允许`, style: 1, key: `${EventKey.Allow}|${approvalId}` },
            { text: `始终允许 (相同参数)`, style: 1, key: `${EventKey.AlwaysArgs}|${approvalId}` },
            { text: `始终允许 (所有参数)`, style: 1, key: `${EventKey.AlwaysTool}|${approvalId}` },
            { text: `拒绝 (${remainSec}s)`, style: 2, key: `${EventKey.Deny}|${approvalId}` },
          ],
        },
      } as any);
    } catch (e: any) {
      getLogger()?.error(`enterApproval error: ${e.message}`, e.stack);
    }
  }

  protected async exitApproval(_approvalId: string): Promise<void> {}

  protected async enterAsk(): Promise<void> {}
  protected async exitAsk(): Promise<void> {}

  // --- Card Event Dispatch ---
  // Called by WecomService's onTriggerAction callback after dispatching to the right user service instance.

  async onTriggerAction(args: WecomActionArgs): Promise<void> {
    const { eventKey, frame } = args;
    const parts = eventKey.split('|');
    const code = parts[0];

    if (code === EventKey.Allow || code === EventKey.AlwaysArgs || code === EventKey.AlwaysTool || code === EventKey.Deny) {
      const id = parts[1];
      if (!id) { getLogger()?.warn(`ToolCall event missing id: ${eventKey}`); return; }
      const statusMap: Partial<Record<string, ToolCallStatus>> = {
        [EventKey.Allow]: ToolCallStatus.Allow,
        [EventKey.AlwaysArgs]: ToolCallStatus.AlwaysArgs,
        [EventKey.AlwaysTool]: ToolCallStatus.AlwaysTool,
        [EventKey.Deny]: ToolCallStatus.Deny,
      };
      this.resolveApproval(id, statusMap[code] ?? ToolCallStatus.Deny);
      return;
    }

    if (code === EventKey.Abort) {
      this.abort();
      return;
    }

    getLogger()?.warn(`Unhandled card event key: ${eventKey}`);
  }
}
