import * as Lark from "@larksuiteoapi/node-sdk";
import { NowDate, parseJson } from "scorpio.ai";
import {LarkActionArgs, LarkMessageArgs} from "./LarkUserServiceBase";
import { ILogger } from "scorpio.ai";
import fs from 'fs';

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
  onRecevieMessage: (userId: string, userInfo:any, chatInfo: any, args: LarkMessageArgs, query: string) => Promise<void>;
  onTriggerAction: (userId: string, userInfo: any, chatInfo: any, args: LarkActionArgs) => Promise<void>;
}


export class LarkService {
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
  private onRecevieMessage: (userId: string, userInfo:any, chatInfo: any, args: LarkMessageArgs, query: string) => Promise<void>;
  private onTriggerAction: (userId: string, userInfo: any, chatInfo: any, args: LarkActionArgs) => Promise<void>;
  private userIdType: LarkUserIdType;
  private tenantAccessToken: string = '';
  private tokenExpireTime: number = 0;

  get idType(): LarkUserIdType { return this.userIdType; }

  constructor(options: LarkServiceOptions) {
    this.onRecevieMessage = options.onRecevieMessage;
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

  dispose() {
    try { this.larkWsClient?.close(); } catch (_) {}
    this.tenantAccessToken = '';
    this.tokenExpireTime = 0;
  }

  async sendMessage(receiveIdType: LarkReceiveIdType, receiveId: string, msgType: string, content: string) {
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

  async replyMessage(message_id: string, msg_type: string, reply_in_thread: boolean, content: string) {
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
  async replayMarkdownMessage(message_id: string, text: string, header:any|undefined = undefined) {
    return await this.replyMessage(message_id, "interactive", false, this.buildMarkdownContent(text, header));
  }

  private buildMarkdownContent(text: string, header: any|undefined): string {
    const content = {
      schema: "2.0",
      config: {
        update_multi: true,
        streaming_mode: false,
      },
      header,
      body: {
        direction: "vertical",
        padding: "12px 12px 12px 12px",
        elements: [
          {
            tag: "markdown",
            content: text,
            text_align: "left",
            text_size: "normal",
            margin: "0px 0px 0px 0px",
          },
        ],
      },
    };
    return JSON.stringify(content);
  }


  async updateCardMessage(messageId: string, elements: any[], header:any|undefined = undefined) {
    if (elements.length === 0) return;

    while ((Date.now() - this.lastCallTime) < this.callInterval) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    this.lastCallTime = Date.now();

    const content = {
      schema: "2.0",
      config: {
        update_multi: true,
        streaming_mode: false,
      },
      header,
      body: {
        direction: "vertical",
        padding: "12px 12px 12px 12px",
        elements: elements,
      },
    };
    return await this.larkClient.im.message.patch({
      path: {message_id: messageId},
      data: {content: JSON.stringify(content)},
    });
  }

  /**
   * 获取 tenant_access_token
   */
  protected async getTenantAccessToken(): Promise<string> {
    if (this.tenantAccessToken && NowDate() < this.tokenExpireTime) {
      return this.tenantAccessToken;
    }
    try {
      const response = await this.larkClient.auth.tenantAccessToken.internal({
        data: {
          app_id: this.larkConfig!.appId,
          app_secret: this.larkConfig!.appSecret,
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


  /**
   * 上传图片到飞书并获取图片 key
   * 支持 base64 data URI 和本地文件路径
   * @param imagePath 图片文件路径（支持本地路径或 base64 data URI）
   * @returns 飞书图片 key (img_xxx)
   */
  async uploadImage(imagePath: string): Promise<string> {
    let imageBuffer: Buffer;
    try {
      if (imagePath.startsWith('data:image/')) {
        const base64Data = imagePath.split(',')[1];
        if (!base64Data) {
          throw new Error('Invalid base64 image data format');
        }
        imageBuffer = Buffer.from(base64Data, 'base64');
      } else {
        if (!fs.existsSync(imagePath)) {
          throw new Error(`Image file not found: ${imagePath}`);
        }
        imageBuffer = fs.readFileSync(imagePath);
      }

      const token = await this.getTenantAccessToken();
      const response = await this.larkClient.im.v1.image.create({
        data: {
          image_type: 'message',
          image: imageBuffer,
        },
      }, Lark.withTenantToken(token)) as any;

      if (!response || !response.image_key) {
        throw new Error(`Lark API error: ${response?.msg || 'unknown error'}`);
      }

      return response.image_key;
    } catch (error: any) {
      this.logger?.error(`Failed to upload image to Lark: ${error.message}\n${error.stack}`);
      throw error;
    }
  }

  /**
   * 上传文件到飞书并获取 file_key
   * 支持本地文件路径或 Buffer
   * @param file 文件路径或 Buffer
   * @param fileName 文件名（含扩展名）
   * @returns 飞书 file_key
   * https://open.feishu.cn/document/server-docs/im-v1/file/create
   */
  async uploadFile(file: string | Buffer, fileName: string): Promise<string> {
    let fileBuffer: Buffer;
    try {
      if (typeof file === 'string') {
        if (!fs.existsSync(file)) {
          throw new Error(`File not found: ${file}`);
        }
        fileBuffer = fs.readFileSync(file);
      } else {
        fileBuffer = file;
      }

      const token = await this.getTenantAccessToken();
      const response = await this.larkClient.im.v1.file.create({
        data: {
          file_type: 'stream',
          file_name: fileName,
          file: fileBuffer,
        },
      }, Lark.withTenantToken(token)) as any;

      if (!response?.data?.file_key) {
        throw new Error(`Lark API error: ${response?.msg || 'unknown error'}`);
      }

      return response.data.file_key;
    } catch (error: any) {
      this.logger?.error(`Failed to upload file to Lark: ${error.message}\n${error.stack}`);
      throw error;
    }
  }

  /**
   * 下载飞书图片，流式写入本地文件
   * @param imageKey 图片 key（img_xxx）
   * @param savePath 保存到本地的文件路径
   * https://open.feishu.cn/document/server-docs/im-v1/image/get
   */
  async downloadImage(imageKey: string, savePath: string): Promise<void> {
    try {
      const token = await this.getTenantAccessToken();
      const response = await this.larkClient.im.v1.image.get({
        path: { image_key: imageKey },
      }, Lark.withTenantToken(token)) as any;
      await this.streamToFile(response, savePath);
    } catch (error: any) {
      this.logger?.error(`Failed to download Lark image: ${error.message}\n${error.stack}`);
      throw error;
    }
  }

  /**
   * 下载飞书文件，流式写入本地文件
   * @param fileKey 文件 key
   * @param savePath 保存到本地的文件路径
   * https://open.feishu.cn/document/server-docs/im-v1/file/get
   */
  async downloadFile(fileKey: string, savePath: string): Promise<void> {
    try {
      const token = await this.getTenantAccessToken();
      const response = await this.larkClient.im.v1.file.get({
        path: { file_key: fileKey },
      }, Lark.withTenantToken(token)) as any;
      await this.streamToFile(response, savePath);
    } catch (error: any) {
      this.logger?.error(`Failed to download Lark file: ${error.message}\n${error.stack}`);
      throw error;
    }
  }

  private streamToFile(stream: NodeJS.ReadableStream, filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(filePath);
      stream.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
      stream.on('error', reject);
    });
  }

  /**
   * 获取用户信息
   * @param userId 用户ID
   * @param userIdType 用户ID类型，默认使用实例配置的类型
   * https://open.feishu.cn/document/server-docs/contact-v3/user/get
   */
  async getUserInfo(userId: string, userIdType?: LarkUserIdType) {
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

  /**
   * 获取群组信息
   * @param chatId 群组 ID
   * https://open.feishu.cn/document/server-docs/group/chat/get-2
   */
  async getChatInfo(chatId: string) {
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

          if (message_type !== "text") return;

          const msg = parseJson(content, { text: "" }) as any;
          let query = String(msg.text ?? "").trim();

          if (query.indexOf("@_all") >= 0) return;

          if (mentions != null) {
            for (const mention of mentions) {
              query = query.replace(mention.key, "");
            }
          }

          

          const userId = sender_id[this.userIdType];
          const [userInfo, chatInfo] = await Promise.all([
            this.getUserInfo(userId),
            this.getChatInfo(chat_id),
          ]);
          await this.onRecevieMessage(userId, userInfo, chatInfo, { larkService: this, event_id, chat_type, chat_id, message_id, root_id }, query.trim())
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
          await this.onTriggerAction(userId, userInfo, chatInfo, { event_id, chat_id: open_chat_id, code: value.code, data: value.data, form_value })
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

