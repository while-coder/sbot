import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WSClient } from '@wecom/aibot-node-sdk';
import type { WsFrame, TextMessage, VoiceMessage, FileMessage, SendMsgBody, EventMessageWith, TemplateCardEventData } from '@wecom/aibot-node-sdk';
import { IChannelService, ChannelSessionHandler, SessionService, type ChannelMessageArgs, type ILogger } from 'channel.base';
import { WecomSessionHandler } from './WecomSessionHandler';

export interface WecomMessageArgs extends ChannelMessageArgs {
  chattype: 'single' | 'group';
  msgid: string;
  frame: WsFrame;
}

export interface WecomActionArgs {
  sessionId: string;
  eventKey: string;
  taskId: string;
  msgid: string;
  frame: WsFrame;
}

export interface WecomServiceOptions {
  botId: string;
  secret: string;
  logger?: ILogger;
  filterEvent: (eventId: string) => Promise<boolean>;
  onReceiveMessage: (userId: string, args: WecomMessageArgs, query: string) => Promise<void>;
  onTriggerAction: (userId: string, args: WecomActionArgs) => Promise<void>;
}

export class WecomService implements IChannelService {
  private wsClient: WSClient;
  private logger?: ILogger;
  private filterEvent: WecomServiceOptions['filterEvent'];
  private onReceiveMessage: WecomServiceOptions['onReceiveMessage'];
  private onTriggerAction: WecomServiceOptions['onTriggerAction'];

  constructor(options: WecomServiceOptions) {
    this.logger = options.logger;
    this.filterEvent = options.filterEvent;
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

  createUserService(session: SessionService): ChannelSessionHandler {
    return new WecomSessionHandler(session, this);
  }

  dispose() {
    try { this.wsClient.disconnect(); } catch (_) {}
  }

  // --- Proxy methods ---

  sendMessage(chatid: string, body: SendMsgBody) {
    return this.wsClient.sendMessage(chatid, body);
  }

  async sendFileMessage(chatid: string, file: string | Buffer, fileName?: string): Promise<void> {
    const fileBuffer = typeof file === 'string' ? await fs.readFile(file) : file;
    fileName ??= typeof file === 'string' ? path.basename(file) : undefined;
    if (!fileName) throw new Error('fileName is required when file is a Buffer');

    const { media_id } = await this.wsClient.uploadMedia(fileBuffer, {
      type: 'file',
      filename: fileName,
    });
    await this.wsClient.sendMediaMessage(chatid, 'file', media_id);
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
    this.wsClient.on('message.file', (frame: WsFrame<FileMessage>) => {
      this.handleFileMessage(frame).catch((e: any) => {
        this.logger?.error(`handleFileMessage error: ${e.stack}`);
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
    if (!await this.filterEvent(`wecom_message_${body.msgid}`)) return;
    await this.onReceiveMessage(userId, {
      sessionId: chatid,
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
    if (!await this.filterEvent(`wecom_message_${body.msgid}`)) return;
    await this.onReceiveMessage(userId, {
      sessionId: chatid,
      chattype: body.chattype,
      msgid: body.msgid,
      frame,
    }, query);
  }

  private async handleFileMessage(frame: WsFrame<FileMessage>) {
    const body = frame.body!;
    const userId = body.from.userid;
    const chatid = body.chatid ?? userId;
    if (!await this.filterEvent(`wecom_message_${body.msgid}`)) return;

    const { buffer, filename } = await this.wsClient.downloadFile(body.file.url, body.file.aeskey);
    const fileName = filename ?? 'unknown_file';
    const ext = path.extname(fileName);
    const filePath = path.join(os.tmpdir(), `wecom_${body.msgid}${ext}`);
    await fs.writeFile(filePath, buffer);

    const query = `<attachment name="${fileName}">${filePath}</attachment>`;
    await this.onReceiveMessage(userId, {
      sessionId: chatid,
      chattype: body.chattype,
      msgid: body.msgid,
      frame,
    }, query);
  }

  private async handleCardEvent(frame: WsFrame<EventMessageWith<TemplateCardEventData>>) {
    const body = frame.body! as any;
    const userId = body.from.userid;
    const eventKey: string = body.event?.template_card_event?.event_key ?? '';
    const taskId: string = body.event?.template_card_event?.task_id ?? '';
    const chatid = body.chatid ?? userId;
    if (!await this.filterEvent(`wecom_action_${body.msgid}`)) return;
    await this.onTriggerAction(userId, {
      sessionId: chatid,
      eventKey,
      taskId,
      msgid: body.msgid,
      frame,
    });
  }
}
