import * as Lark from "@larksuiteoapi/node-sdk";
import {Util} from "weimingcommons";
import {LarkUserService} from "./LarkUserService";
import {database} from "../Database";
import {Op} from "sequelize";
import {config} from "../Config";
import {LoggerService} from "../LoggerService";
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

const logger = LoggerService.getLogger("LarkService.ts");

const HourMilliseconds = 1000 * 60 * 60;
const CheckInterval = HourMilliseconds;
const ExpireTime = HourMilliseconds * 24 * 3;


class LarkService {
  private checkTime = 0;
  private larkClient!: Lark.Client;
  private larkWsClient!: Lark.WSClient;

  async start() {
    let baseConfig = {
      appId: config.settings.lark!.appId!,
      appSecret: config.settings.lark!.appSecret!,
    };
    this.checkTime = 0;
    this.larkClient = new Lark.Client(baseConfig);
    this.larkWsClient = new Lark.WSClient(baseConfig);

    this.registerEventDispatcher()
  }

  async sendMessage(chatId: string, msgType: string, content: string) {
    try {
      const response = await this.larkClient.im.message.create({
        params: { receive_id_type: "chat_id" },
        data: { receive_id: chatId, msg_type: msgType, content },
      });
      if (response.code !== 0) {
        throw new Error(`发送消息失败 / Failed to send message: ${response.msg}`);
      }
      return response.data;
    } catch (error) {
      logger.error("发送消息出错 / Error sending message:", error);
    }
  }

  async sendMarkdownMessage(chatId: string, text: string, header:any|undefined = undefined) {
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
    return await this.sendMessage(chatId, "interactive", JSON.stringify(content));
  }

  async updateCardMessage(messageId: string, elements: any[], header:any|undefined = undefined) {
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

  async clearExpiredMessage() {
    const now = Util.NowDate;
    if (now < this.checkTime) return;

    this.checkTime = now + CheckInterval;

    await database.destroy(database.message, {
      where: {
        expireTime: { [Op.lt]: now },
      },
    });
  }

  /**
   * 从 URL 下载图片到本地临时文件
   * @param imageUrl 图片 URL
   * @returns 临时文件路径
   */
  private async downloadImageFromUrl(imageUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const protocol = imageUrl.startsWith('https') ? https : http;
      const tempDir = config.getConfigPath('temp', true);
      const tempFile = path.join(tempDir, `image_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`);

      const file = fs.createWriteStream(tempFile);

      protocol.get(imageUrl, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`下载图片失败: HTTP ${response.statusCode}`));
          return;
        }

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve(tempFile);
        });

        file.on('error', (err) => {
          fs.unlinkSync(tempFile);
          reject(err);
        });
      }).on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * 上传图片到飞书并获取图片 key
   * @param imagePath 图片文件路径（支持本地路径或 HTTP/HTTPS URL）
   * @returns 飞书图片 key (img_xxx)
   */
  async uploadImageToLark(imagePath: string): Promise<string> {
    let localImagePath = imagePath;
    let isTemporaryFile = false;

    try {
      // 如果是 URL，先下载到本地
      if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
        logger.info(`正在从 URL 下载图片: ${imagePath}`);
        localImagePath = await this.downloadImageFromUrl(imagePath);
        isTemporaryFile = true;
      }

      // 检查文件是否存在
      if (!fs.existsSync(localImagePath)) {
        throw new Error(`图片文件不存在: ${localImagePath}`);
      }

      // 读取图片文件
      const imageBuffer = fs.readFileSync(localImagePath);

      logger.info(`正在上传图片到飞书 (${imageBuffer.length} bytes)`);

      // 上传图片到飞书
      const response = await this.larkClient.im.v1.image.create({
        data: {
          image_type: 'message',
          image: imageBuffer
        }
      });

      if (!response || !(response as any).data || !(response as any).data.image_key) {
        throw new Error('飞书返回数据格式错误');
      }

      const imageKey = (response as any).data.image_key;
      logger.info(`图片上传成功，image_key: ${imageKey}`);

      return imageKey;

    } catch (error: any) {
      logger.error(`上传图片到飞书失败: ${error.message}`);
      throw error;
    } finally {
      // 清理临时文件
      if (isTemporaryFile && localImagePath && fs.existsSync(localImagePath)) {
        try {
          fs.unlinkSync(localImagePath);
        } catch (e) {
          logger.warn(`清理临时文件失败: ${localImagePath}`);
        }
      }
    }
  }

  /**
   * 转换工具返回内容中的图片链接为飞书图片格式
   * 检测内容中的图片路径或 URL，自动上传到飞书并替换为飞书图片标签
   * @param content 工具返回的内容
   * @returns 转换后的内容
   */
  async convertImagesToLarkFormat(content: string): Promise<string> {
    try {
      // 正则匹配常见的图片模式
      // 1. Markdown 图片：![alt](path/to/image.png)
      // 2. HTML img 标签：<img src="path/to/image.png" />
      // 3. 纯图片 URL：http(s)://.../*.{png,jpg,jpeg,gif,webp}
      // 4. 本地文件路径：/path/to/image.{png,jpg,jpeg,gif,webp}

      const imagePatterns = [
        // Markdown 图片: ![alt](url)
        /!\[([^\]]*)\]\(([^)]+\.(?:png|jpg|jpeg|gif|webp|bmp))\)/gi,
        // HTML img 标签: <img src="url" />
        /<img[^>]+src=["']([^"']+\.(?:png|jpg|jpeg|gif|webp|bmp))["'][^>]*>/gi,
        // 纯 URL 或本地路径（以图片扩展名结尾的路径）
        /(?:https?:\/\/[^\s]+|\/[^\s]+)\.(?:png|jpg|jpeg|gif|webp|bmp)/gi
      ];

      let convertedContent = content;
      const imageCache = new Map<string, string>(); // 缓存已上传的图片，避免重复上传

      for (const pattern of imagePatterns) {
        const matches = content.matchAll(pattern);

        for (const match of matches) {
          const fullMatch = match[0];
          // 提取图片路径（不同模式有不同的捕获组）
          const imagePath = match[2] || match[1] || fullMatch;

          // 跳过已经是飞书图片格式的内容
          if (imagePath.startsWith('img_')) {
            continue;
          }

          try {
            // 检查缓存
            let imageKey: string;
            if (imageCache.has(imagePath)) {
              imageKey = imageCache.get(imagePath)!;
            } else {
              // 上传图片到飞书
              imageKey = await this.uploadImageToLark(imagePath);
              imageCache.set(imagePath, imageKey);
            }

            // 替换为飞书图片标签
            // 飞书消息中使用 <img img_key="xxx" /> 格式
            const larkImageTag = `<img img_key="${imageKey}" />`;
            convertedContent = convertedContent.replace(fullMatch, larkImageTag);

            logger.info(`已转换图片: ${imagePath} -> ${imageKey}`);
          } catch (error: any) {
            logger.error(`转换图片失败 ${imagePath}: ${error.message}`);
            // 转换失败，保留原始内容
          }
        }
      }

      return convertedContent;
    } catch (error: any) {
      logger.error(`图片转换过程出错: ${error.message}`);
      return content; // 出错时返回原始内容
    }
  }

  async registerEventDispatcher() {
    const eventDispatcher = new Lark.EventDispatcher({}).register({
      "im.message.receive_v1": async (data: any) => {
        try {
          const {
            event_id,
            message: { 
              chat_type,
              message_type,
              chat_id,
              content,
              mentions
            },
            sender: {
              sender_id: {
                open_id,    //不同应用 open_id 不同
                union_id,   //不同组织 union_id不同
                user_id,    //唯一ID
              },
            },
          } = data;

          if (message_type !== "text") return;

          const msg = Util.parseJson(content, { text: "" }) as any;
          let query = String(msg.text ?? "").trim();

          if (query.indexOf("@_all") >= 0) return;

          if (mentions != null) {
            for (const mention of mentions) {
              query = query.replace(mention.key, "");
            }
          }

          await this.clearExpiredMessage();

          if ((await database.count(database.message, { where: { id: event_id } })) > 0) return;

          await database.create(database.message, { id: event_id, expireTime: Util.NowDate + ExpireTime });

          const userService = LarkUserService.getUserAgentService(union_id);
          userService.onReceiveLarkMessage(chat_type, chat_id, query.trim()).then(() => {})
        } catch (e: any) {
          logger.error(`Receive message error: ${e.stack}`);
          return;
        }
      },

      "card.action.trigger": async (data: any) => {
        try {
          const {
            event_id,
            action: { form_value, value },
            operator: {
              user_id,
            },
            context: {
              open_chat_id,
            }
          } = data;
          await this.clearExpiredMessage()
          if ((await database.count(database.message, { where: { id: event_id } })) > 0) return;

          await database.create(database.message, { id: event_id, expireTime: Util.NowDate + ExpireTime });

          const agentService = LarkUserService.getUserAgentService(user_id);
          return await agentService.onTriggerAction(open_chat_id, value.code, value.data, form_value)
        } catch (e: any) {
          logger.error(`Card Action error: ${e.stack}`);
          return;
        }
      },
      "application.bot.menu_v6": async (data: any) => {
        console.log(`application.bot.menu_v6 : `, data);
      },
    });
    await this.larkWsClient.start({ eventDispatcher }).catch((e) => {
      logger.error(`registerEventDispatcher catch error: ${e}`);
    });
  }
}

export const larkService = new LarkService();
