import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WSClient } from '@wecom/aibot-node-sdk';
import type { WsFrame, TextMessage, VoiceMessage, FileMessage, ImageMessage, MixedMessage, SendMsgBody, EventMessageWith, TemplateCardEventData } from '@wecom/aibot-node-sdk';
import { IChannelService, ChannelSessionHandler, SessionService, readImageAsDataUrl, isEmptyContent, type ChannelMessageArgs, type ILogger, type MessageContent } from 'channel.base';
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
  onReceiveMessage: (userId: string, args: WecomMessageArgs, query: MessageContent) => Promise<void>;
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
    this.wsClient.on('message.image', (frame: WsFrame<ImageMessage>) => {
      this.handleImageMessage(frame).catch((e: any) => {
        this.logger?.error(`handleImageMessage error: ${e.stack}`);
      });
    });
    this.wsClient.on('message.mixed', (frame: WsFrame<MixedMessage>) => {
      this.handleMixedMessage(frame).catch((e: any) => {
        this.logger?.error(`handleMixedMessage error: ${e.stack}`);
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
    if (isEmptyContent(query)) return;

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
    if (isEmptyContent(query)) return;

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

    const query = `[file: ${fileName}](${filePath})`;
    await this.onReceiveMessage(userId, {
      sessionId: chatid,
      chattype: body.chattype,
      msgid: body.msgid,
      frame,
    }, query);
  }

  private async downloadWecomFile(url: string, aeskey?: string, msgid?: string, ext?: string): Promise<string> {
    const { buffer, filename } = await this.wsClient.downloadFile(url, aeskey);
    const finalExt = ext ?? (filename ? path.extname(filename) : '');
    const filePath = path.join(os.tmpdir(), `wecom_${msgid ?? Date.now()}${finalExt}`);
    await fs.writeFile(filePath, buffer);
    return filePath;
  }

  private async handleImageMessage(frame: WsFrame<ImageMessage>) {
    const body = frame.body!;
    const userId = body.from.userid;
    const chatid = body.chatid ?? userId;
    if (!await this.filterEvent(`wecom_message_${body.msgid}`)) return;

    const filePath = await this.downloadWecomFile(body.image.url, body.image.aeskey, body.msgid, '.png');
    const dataUrl = await readImageAsDataUrl(filePath);
    const query: MessageContent = [{ type: 'image_url', image_url: { url: dataUrl } }];
    await this.onReceiveMessage(userId, {
      sessionId: chatid,
      chattype: body.chattype,
      msgid: body.msgid,
      frame,
    }, query);
  }

  private async handleMixedMessage(frame: WsFrame<MixedMessage>) {
    const body = frame.body!;
    const userId = body.from.userid;
    const chatid = body.chatid ?? userId;
    if (!await this.filterEvent(`wecom_message_${body.msgid}`)) return;

    const parts: Array<{ type: string; text?: string; [key: string]: any }> = [];
    let hasImage = false;
    for (const item of body.mixed?.msg_item ?? []) {
      if (item.msgtype === 'text' && item.text?.content) {
        parts.push({ type: 'text', text: item.text.content });
      } else if (item.msgtype === 'image' && item.image?.url) {
        const filePath = await this.downloadWecomFile(item.image.url, item.image.aeskey, `${body.msgid}_${parts.length}`, '.png');
        const dataUrl = await readImageAsDataUrl(filePath);
        parts.push({ type: 'image_url', image_url: { url: dataUrl } });
        hasImage = true;
      }
    }

    const query: MessageContent = hasImage ? parts : parts.map(p => p.text!).join('\n').trim();
    if (isEmptyContent(query)) return;
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
