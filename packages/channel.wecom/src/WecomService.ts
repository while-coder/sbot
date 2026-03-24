import { WSClient } from '@wecom/aibot-node-sdk';
import type { WsFrame, TextMessage, VoiceMessage, SendMsgBody, EventMessageWith, TemplateCardEventData } from '@wecom/aibot-node-sdk';
import type { ILogger } from 'scorpio.ai';

export interface WecomMessageArgs {
  wecomService: WecomService;
  chatid: string;         // single: userid, group: chatid
  chattype: 'single' | 'group';
  msgid: string;
  frame: WsFrame;
}

export interface WecomActionArgs {
  chatid: string;
  eventKey: string;
  taskId: string;
  msgid: string;
  frame: WsFrame;
}

export interface WecomServiceOptions {
  botId: string;
  secret: string;
  logger?: ILogger;
  onReceiveMessage: (userId: string, args: WecomMessageArgs, query: string) => Promise<void>;
  onTriggerAction: (userId: string, args: WecomActionArgs) => Promise<void>;
}

export class WecomService {
  private wsClient: WSClient;
  private logger?: ILogger;
  private onReceiveMessage: WecomServiceOptions['onReceiveMessage'];
  private onTriggerAction: WecomServiceOptions['onTriggerAction'];

  constructor(options: WecomServiceOptions) {
    this.logger = options.logger;
    this.onReceiveMessage = options.onReceiveMessage;
    this.onTriggerAction = options.onTriggerAction;

    this.wsClient = new WSClient({
      botId: options.botId,
      secret: options.secret,
      logger: {
        debug: (m: string, ...a: any[]) => options.logger?.debug(m, ...a),
        info:  (m: string, ...a: any[]) => options.logger?.info(m, ...a),
        warn:  (m: string, ...a: any[]) => options.logger?.warn(m, ...a),
        error: (m: string, ...a: any[]) => options.logger?.error(m, ...a),
      },
    });
  }

  dispose() {
    try { this.wsClient.disconnect(); } catch (_) {}
  }

  // --- Proxy methods ---

  sendMessage(chatid: string, body: SendMsgBody) {
    return this.wsClient.sendMessage(chatid, body);
  }

  // --- Connection ---

  connect() {
    this.wsClient.connect();

    this.wsClient.on('authenticated', () => {
      this.logger?.info('WeCom WSClient authenticated');
    });
    this.wsClient.on('disconnected', (reason) => {
      this.logger?.warn(`WeCom WSClient disconnected: ${reason}`);
    });
    this.wsClient.on('error', (err) => {
      this.logger?.error(`WeCom WSClient error: ${err.message}`);
    });
    this.wsClient.on('message.text', (frame: WsFrame<TextMessage>) => {
      this.handleTextMessage(frame).catch((e: any) => {
        this.logger?.error(`handleTextMessage error: ${e.stack}`);
      });
    });
    this.wsClient.on('message.voice', (frame: WsFrame<VoiceMessage>) => {
      this.handleVoiceMessage(frame).catch((e: any) => {
        this.logger?.error(`handleVoiceMessage error: ${e.stack}`);
      });
    });
    this.wsClient.on('event.template_card_event', (frame: WsFrame<EventMessageWith<TemplateCardEventData>>) => {
      this.handleCardEvent(frame).catch((e: any) => {
        this.logger?.error(`handleCardEvent error: ${e.stack}`);
      });
    });
  }

  private async handleTextMessage(frame: WsFrame<TextMessage>) {
    const body = frame.body!;
    const query = body.text?.content?.trim() ?? '';
    if (!query) return;

    const userId = body.from.userid;
    const chatid = body.chatid ?? userId;
    await this.onReceiveMessage(userId, {
      wecomService: this,
      chatid,
      chattype: body.chattype,
      msgid: body.msgid,
      frame,
    }, query);
  }

  private async handleVoiceMessage(frame: WsFrame<VoiceMessage>) {
    const body = frame.body!;
    const query = body.voice?.content?.trim() ?? '';
    if (!query) return;

    const userId = body.from.userid;
    const chatid = body.chatid ?? userId;
    await this.onReceiveMessage(userId, {
      wecomService: this,
      chatid,
      chattype: body.chattype,
      msgid: body.msgid,
      frame,
    }, query);
  }

  private async handleCardEvent(frame: WsFrame<EventMessageWith<TemplateCardEventData>>) {
    const body = frame.body! as any;
    const userId = body.from.userid;
    // body.event.template_card_event
    // body.event.template_card_event.event_key
    // body.event.template_card_event.task_id
    const eventKey: string = body.event?.template_card_event?.event_key ?? '';
    const taskId: string = body.event?.template_card_event?.task_id ?? '';
    const chatid = body.chatid ?? userId;
    await this.onTriggerAction(userId, {
      chatid,
      eventKey,
      taskId,
      msgid: body.msgid,
      frame,
    });
  }
}
