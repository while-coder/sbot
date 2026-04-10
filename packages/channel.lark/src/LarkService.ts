import * as Lark from "@larksuiteoapi/node-sdk";
import { LarkActionArgs, LarkMessageArgs, LarkSessionHandler } from "./LarkSessionHandler";
import { IChannelService, ChannelSessionHandler, SessionService, NowDate, parseJson, readFileAsDataUrl, type ILogger, type MessageContent } from "channel.base";
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

function removeMentions(content: MessageContent, mentions: Array<{ key: string }>): MessageContent {
  if (!mentions?.length) return content;
  if (typeof content === 'string') {
    let result = content;
    for (const mention of mentions) result = result.replaceAll(mention.key, '');
    return result;
  }
  return content.map(part => {
    if (part.type === 'text' && part.text) {
      let text = part.text;
      for (const mention of mentions) text = text.replaceAll(mention.key, '');
      return { ...part, text };
    }
    return part;
  });
}

/** 消息接收 ID 类型（涵盖所有飞书支持的类型） */
export enum LarkReceiveIdType {
  OpenId   = 'open_id',
  UnionId  = 'union_id',
  UserId   = 'user_id',
  Email    = 'email',
  ChatId   = 'chat_id',
}
/** 用户身份 ID 类型（LarkReceiveIdType 的子集，不含 email / chat_id） */
export enum LarkUserIdType {
  OpenId  = 'open_id',
  UnionId = 'union_id',
  UserId  = 'user_id',
}

export interface LarkServiceOptions {
  appId: string;
  appSecret: string;
  userIdType: LarkUserIdType;
  logger?: ILogger;
  filterEvent: (eventId: string) => Promise<boolean>;
  onReceiveMessage: (userId: string, userInfo:any, chatInfo: any, args: LarkMessageArgs, query: MessageContent) => Promise<void>;
  onTriggerAction: (userId: string, userInfo: any, chatInfo: any, args: LarkActionArgs) => Promise<void>;
}


export class LarkService implements IChannelService {
  // 速率限制：1000 次/分钟、50 次/秒，固定间隔 65ms
  private lastCallTime = 0;
  private readonly callInterval = 65; // ms
  private larkConfig: { appId: string, appSecret: string};
  private larkClient: Lark.Client;
  private larkWsClient: Lark.WSClient;
  private logger?: ILogger;
  private larkLogger: any;
  private loggerLevel: Lark.LoggerLevel;
  private filterEvent: (eventId: string) => Promise<boolean>;
  private onReceiveMessage: (userId: string, userInfo:any, chatInfo: any, args: LarkMessageArgs, query: MessageContent) => Promise<void>;
  private onTriggerAction: (userId: string, userInfo: any, chatInfo: any, args: LarkActionArgs) => Promise<void>;
  private userIdType: LarkUserIdType;
  private tenantAccessToken: string = '';
  private tokenExpireTime: number = 0;

  constructor(options: LarkServiceOptions) {
    this.onReceiveMessage = options.onReceiveMessage;
    this.onTriggerAction = options.onTriggerAction;
    this.filterEvent = options.filterEvent;
    this.userIdType = options.userIdType;
    this.logger = options.logger;
    this.larkConfig = { appId: options.appId, appSecret: options.appSecret };
    this.loggerLevel = Lark.LoggerLevel.warn;
    this.larkLogger = options.logger ? {
      trace: (msg: string, ...args: any[]) => options.logger?.debug(msg, ...args),
      debug: (msg: string, ...args: any[]) => options.logger?.debug(msg, ...args),
      info:  (msg: string, ...args: any[]) => options.logger?.info(msg, ...args),
      warn:  (msg: string, ...args: any[]) => options.logger?.warn(msg, ...args),
      error: (msg: string, ...args: any[]) => options.logger?.error(msg, ...args),
    } : undefined;
    this.larkClient = new Lark.Client({ ...this.larkConfig, logger: this.larkLogger, loggerLevel: this.loggerLevel });
    this.larkWsClient = new Lark.WSClient({ ...this.larkConfig, logger: this.larkLogger, loggerLevel: this.loggerLevel });
  }

  createUserService(session: SessionService): ChannelSessionHandler {
    return new LarkSessionHandler(session, this);
  }

  dispose() {
    try { this.larkWsClient?.close(); } catch (_) {}
    this.tenantAccessToken = '';
    this.tokenExpireTime = 0;
  }

  private async sendMessage(receiveIdType: LarkReceiveIdType, receiveId: string, msgType: string, content: string) {
    try {
      const response = await this.larkClient.im.message.create({
        params: { receive_id_type: receiveIdType as any },
        data: { receive_id: receiveId, msg_type: msgType, content },
      });
      if (response.code !== 0) {
        throw new Error(`Failed to send message: ${response.msg}`);
      }
      return response.data;
    } catch (error) {
      this.logger?.error("Error sending message:", error);
    }
  }
  async sendMarkdownMessage(receiveIdType: LarkReceiveIdType, receiveId: string, text: string, header: any | undefined = undefined) {
    return await this.sendMessage(receiveIdType, receiveId, "interactive", this.buildMarkdownContent(text, header));
  }

  async sendFileMessage(receiveIdType: LarkReceiveIdType, receiveId: string, file: string | Buffer, fileName?: string) {
    const fileKey = await this.uploadFile(file, fileName);
    return await this.sendMessage(receiveIdType, receiveId, "file", JSON.stringify({ file_key: fileKey }));
  }

  private async replyMessage(message_id: string, msg_type: string, reply_in_thread: boolean, content: string) {
    try {
      const response = await this.larkClient.im.message.reply({
        path: { message_id },
        data: { msg_type, reply_in_thread, content },
      });
      if (response.code !== 0) {
        throw new Error(`Failed to send message: ${response.msg}`);
      }
      return response.data;
    } catch (error) {
      this.logger?.error("Error sending message:", error);
    }
  }
  async replyMarkdownMessage(message_id: string, text: string, header:any|undefined = undefined) {
    return await this.replyMessage(message_id, "interactive", false, this.buildMarkdownContent(text, header));
  }

  private buildCardJson(elements: any[], header?: any): string {
    return JSON.stringify({
      schema: "2.0",
      config: { update_multi: true, streaming_mode: false },
      header,
      body: {
        direction: "vertical",
        padding: "12px 12px 12px 12px",
        elements,
      },
    });
  }

  private buildMarkdownContent(text: string, header?: any): string {
    return this.buildCardJson([{
      tag: "markdown", content: text, text_align: "left", text_size: "normal", margin: "0px 0px 0px 0px",
    }], header);
  }

  async updateCardMessage(messageId: string, elements: any[], header?: any) {
    if (elements.length === 0) return;

    while ((Date.now() - this.lastCallTime) < this.callInterval) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    this.lastCallTime = Date.now()
    return await this.larkClient.im.message.patch({
      path: { message_id: messageId },
      data: { content: this.buildCardJson(elements, header) },
    });
  }

  private async getTenantAccessToken(): Promise<string> {
    if (this.tenantAccessToken && NowDate() < this.tokenExpireTime) {
      return this.tenantAccessToken;
    }
    try {
      const response = await this.larkClient.auth.tenantAccessToken.internal({
        data: {
          app_id: this.larkConfig.appId,
          app_secret: this.larkConfig.appSecret,
        },
      }) as any;

      if (response.code !== 0) {
        throw new Error(`Failed to get tenant_access_token: ${response.msg}`);
      }

      this.tenantAccessToken = response.tenant_access_token;
      this.tokenExpireTime = NowDate() + (response.expire - 300) * 1000;
      return this.tenantAccessToken;
    } catch (error: any) {
      this.logger?.error(`Failed to get tenant_access_token: ${error.message}`);
      throw error;
    }
  }


  /** https://open.feishu.cn/document/server-docs/im-v1/file/create */
  private async uploadFile(file: string | Buffer, fileName?: string): Promise<string> {
    try {
      const fileBuffer = typeof file === 'string' ? await fs.readFile(file) : file;
      fileName ??= typeof file === 'string' ? path.basename(file) : undefined;
      if (!fileName) throw new Error('fileName is required when file is a Buffer');

      const token = await this.getTenantAccessToken();
      const response = await this.larkClient.im.v1.file.create({
        data: { file_type: 'stream', file_name: fileName, file: fileBuffer },
      }, Lark.withTenantToken(token)) as any;

      if (!response?.file_key) {
        throw new Error(`Lark API error: ${JSON.stringify(response)}`);
      }
      return response.file_key;
    } catch (error: any) {
      this.logger?.error(`Failed to upload file: ${error.message}\n${error.stack}`);
      throw error;
    }
  }

  /** https://open.feishu.cn/document/server-docs/im-v1/message-content/get-2 */
  private async downloadMessageFile(messageId: string, fileKey: string, fileType: "image"| "file", savePath: string): Promise<void> {
    try {
      const token = await this.getTenantAccessToken();
      const response = await this.larkClient.im.v1.messageResource.get({
        path: { message_id: messageId, file_key: fileKey },
        params: { type: fileType },
      }, Lark.withTenantToken(token)) as any;
      await response.writeFile(savePath);
    } catch (error: any) {
      this.logger?.error(`Failed to download message file: ${error.message}\n${error.stack}`);
      throw error;
    }
  }

  private async extractPostContent(messageId: string, msg: any): Promise<MessageContent> {
    const paragraphs: any[][] = msg.content ?? [];
    const parts: Array<{ type: string; text?: string; [key: string]: any }> = [];
    let hasImage = false;
    for (const paragraph of paragraphs) {
      for (const el of paragraph) {
        if (el.tag === 'text') {
          parts.push({ type: 'text', text: el.text ?? '' });
        } else if (el.tag === 'img') {
          const filePath = path.join(os.tmpdir(), `lark_${el.image_key}`);
          await this.downloadMessageFile(messageId, el.image_key, 'image', filePath);
          const dataUrl = await readFileAsDataUrl(filePath);
          parts.push({ type: 'image_url', image_url: { url: dataUrl } });
          hasImage = true;
        } else {
          this.logger?.warn(`Unsupported post element tag: ${el.tag}`);
        }
      }
    }
    if (!hasImage) return parts.map(p => p.text!).join('\n');
    return parts;
  }

  private async extractImageContent(messageId: string, msg: any): Promise<MessageContent> {
    const filePath = path.join(os.tmpdir(), `lark_${msg.image_key}`);
    await this.downloadMessageFile(messageId, msg.image_key, 'image', filePath);
    const dataUrl = await readFileAsDataUrl(filePath);
    return [{ type: 'image_url', image_url: { url: dataUrl } }];
  }

  private async extractFileContent(messageId: string, msg: any): Promise<string> {
    const file_name = msg.file_name ?? ''
    const ext = path.extname(file_name);
    const filePath = path.join(os.tmpdir(), `lark_${msg.file_key}${ext}`);
    await this.downloadMessageFile(messageId, msg.file_key, 'file', filePath);
    return `[file: ${file_name}](${filePath})`;
  }

  /** https://open.feishu.cn/document/server-docs/contact-v3/user/get */
  private async getUserInfo(userId: string, userIdType?: LarkUserIdType) {
    try {
      const idType = (userIdType || this.userIdType) as LarkUserIdType;
      const response = await this.larkClient.contact.user.get({
        path: { user_id: userId },
        params: { user_id_type: idType },
      });
      if (response.code !== 0) {
        throw new Error(`Failed to get user info: ${response.msg}`);
      }
      return response.data?.user;
    } catch (error: any) {
      this.logger?.error(`Error getting user info: ${error.message}`);
    }
  }

  /** https://open.feishu.cn/document/server-docs/group/chat/get-2 */
  private async getChatInfo(chatId: string) {
    try {
      const response = await this.larkClient.im.v1.chat.get({
        path: { chat_id: chatId },
        params: { user_id_type: "open_id" }
      });
      if (response.code !== 0) {
        throw new Error(`Failed to get chat info: ${response.msg}`);
      }
      return response.data;
    } catch (error: any) {
      this.logger?.error(`Error getting chat info: ${error.message}`);
    }
  }

  async registerEventDispatcher() {
    const eventDispatcher = new Lark.EventDispatcher({logger: this.larkLogger, loggerLevel: this.loggerLevel}).register({
      "im.message.receive_v1": async (data: any) => {
        try {
          const {
            event_id,
            message: { 
              chat_type,
              chat_id,
              message_type,
              message_id,
              parent_id,
              root_id,
              content,
              mentions
            },
            sender: {
              sender_id,
            },
          } = data;

          if (!await this.filterEvent(`lark_message_${event_id}`)) return;

          const msg = parseJson(content, { text: "" }) as any;
          let query: MessageContent = "";

          if (message_type === "post") {
            query = await this.extractPostContent(message_id, msg);
          } else if (message_type === "text") {
            query = String(msg.text ?? "").trim();
          } else if (message_type === 'image') {
            query = await this.extractImageContent(message_id, msg);
          } else if (message_type === 'file') {
            query = await this.extractFileContent(message_id, msg);
          } else {
            this.logger?.error(`不支持的消息类型: ${message_type}`);
            return
          }

          if (mentions != null) {
            query = removeMentions(query, mentions);
          }

          const userId = sender_id[this.userIdType];
          const [userInfo, chatInfo] = await Promise.all([
            this.getUserInfo(userId),
            this.getChatInfo(chat_id),
          ]);
          await this.onReceiveMessage(userId, userInfo, chatInfo, { event_id, chat_type, sessionId: chat_id, message_id, root_id, message_type }, typeof query === 'string' ? query.trim() : query)
        } catch (e: any) {
          this.logger?.error(`Receive message error: ${e.stack}`);
        }
      },

      "card.action.trigger": async (data: any) => {
        try {
          const {
            event_id,
            action: { form_value, value },
            operator,
            context: {
              open_chat_id,
            }
          } = data;

          if (!await this.filterEvent(`lark_action_${event_id}`)) return;
          
          const userId = operator[this.userIdType];
          const [userInfo, chatInfo] = await Promise.all([
            this.getUserInfo(userId),
            this.getChatInfo(open_chat_id),
          ]);
          await this.onTriggerAction(userId, userInfo, chatInfo, { event_id, sessionId: open_chat_id, code: value.code, data: value.data, form_value })
        } catch (e: any) {
          this.logger?.error(`Card Action error: ${e.stack}`);
        }
      },
      "application.bot.menu_v6": async (_data: any) => {
      },
    });
    await this.larkWsClient.start({ eventDispatcher }).catch((e) => {
      this.logger?.error(`registerEventDispatcher catch error: ${e}`);
    });
  }
}

