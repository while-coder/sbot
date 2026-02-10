import * as Lark from "@larksuiteoapi/node-sdk";
import {Util} from "weimingcommons";
import {LarkUserService} from "./LarkUserService";
import {database} from "../Database";
import {Op} from "sequelize";
import {config} from "../Config";
import {LoggerService} from "../LoggerService";
import fs from 'fs';
import { MCPToolResult, MCPContentType } from "scorpio.ai";

const logger = LoggerService.getLogger("LarkService.ts");

const HourMilliseconds = 1000 * 60 * 60;
const CheckInterval = HourMilliseconds;
const ExpireTime = HourMilliseconds * 24 * 3;


class LarkService {
  private checkTime = 0;
  // 速率限制：1000 次/分钟、50 次/秒，固定间隔 65ms
  private lastCallTime = 0;
  private readonly callInterval = 65; // ms
  private larkConfig: { appId: string, appSecret: string} | undefined;
  private larkClient!: Lark.Client;
  private larkWsClient!: Lark.WSClient;
  private tenantAccessToken: string = '';
  private tokenExpireTime: number = 0;

  async start() {
    this.larkConfig = {
      appId: config.settings.lark!.appId!,
      appSecret: config.settings.lark!.appSecret!,
    };
    this.checkTime = 0;
    this.larkClient = new Lark.Client(this.larkConfig);
    this.larkWsClient = new Lark.WSClient(this.larkConfig);

    this.registerEventDispatcher()
  }

  /**
   * 获取 tenant_access_token
   * @returns tenant_access_token
   */
  private async getTenantAccessToken(): Promise<string> {
    // 如果 token 还未过期，直接返回
    if (this.tenantAccessToken && Util.NowDate < this.tokenExpireTime) {
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
        throw new Error(`获取 tenant_access_token 失败: ${response.msg}`);
      }

      this.tenantAccessToken = response.tenant_access_token;
      // 提前 5 分钟过期，避免边界问题
      this.tokenExpireTime = Util.NowDate + (response.expire - 300) * 1000;

      logger.info(`成功获取 tenant_access_token，过期时间: ${new Date(this.tokenExpireTime).toISOString()}`);
      return this.tenantAccessToken;
    } catch (error: any) {
      logger.error(`获取 tenant_access_token 失败: ${error.message}`);
      throw error;
    }
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
   * 上传图片到飞书并获取图片 key
   * 只支持 base64 data URI 和本地文件路径
   * @param imagePath 图片文件路径（支持本地路径或 base64 data URI）
   * @returns 飞书图片 key (img_xxx)
   */
  async uploadImageToLark(imagePath: string): Promise<string> {
    let imageBuffer: Buffer;

    try {
      // 如果是 base64 数据 (data:image/xxx;base64,...)
      if (imagePath.startsWith('data:image/')) {
        logger.info(`正在解析 base64 图片数据`);
        const base64Data = imagePath.split(',')[1];
        if (!base64Data) {
          throw new Error('无效的 base64 图片数据格式');
        }
        imageBuffer = Buffer.from(base64Data, 'base64');
      }
      // 作为本地文件路径处理
      else {
        // 检查文件是否存在
        if (!fs.existsSync(imagePath)) {
          throw new Error(`图片文件不存在: ${imagePath}`);
        }
        // 读取图片文件
        imageBuffer = fs.readFileSync(imagePath);
      }

      logger.info(`正在上传图片到飞书 (${imageBuffer.length} bytes)`);

      // 获取 tenant_access_token
      const token = await this.getTenantAccessToken();

      // 使用 Lark SDK 上传图片
      const response = await this.larkClient.im.v1.image.create({
        data: {
          image_type: 'message',
          image: imageBuffer,
        },
      }, Lark.withTenantToken(token)) as any;

      if (!response || !response.image_key) {
        throw new Error(`飞书返回错误: ${response?.msg || '未知错误'}`);
      }

      const imageKey = response.image_key;
      logger.info(`图片上传成功，image_key: ${imageKey}`);

      return imageKey;

    } catch (error: any) {
      logger.error(`上传图片到飞书失败: ${error.message}\n${error.stack}`);
      throw error;
    }
  }

  /**
   * 转换 MCP 格式结果中的图片为飞书图片格式
   * 只处理 base64 和本地文件，不处理 HTTP/HTTPS URL
   * @param result MCP 格式的工具结果
   * @returns 转换后的 MCP 格式结果
   */
  async convertMCPImagesToLarkFormat(result: MCPToolResult): Promise<MCPToolResult> {
    try {
      // 创建新的结果对象，保留 isError 标志
      const convertedResult: MCPToolResult = {
        content: [],
        isError: result.isError,
      };

      // 处理每个内容块
      for (const contentItem of result.content) {
        if (contentItem.type === MCPContentType.Image || contentItem.type === MCPContentType.ImageUrl) {
          // 处理图片内容（MCP 图片或 OpenAI 风格的 image_url），只处理 base64 或本地文件
          try {
            // 获取图片数据或 URL
            let imageData: string;
            if (contentItem.type === MCPContentType.Image) {
              imageData = contentItem.data;
            } else {
              // 支持 url 或 image_url 字段
              const urlField = contentItem.url || contentItem.image_url;
              if (!urlField) {
                throw new Error('图片 URL 字段为空');
              }
              imageData = typeof urlField === 'string' ? urlField : urlField.url;
            }

            // 跳过 HTTP/HTTPS URL
            if (imageData.startsWith('http://') || imageData.startsWith('https://')) {
              logger.info(`跳过 HTTP/HTTPS 图片 URL: ${imageData}`);
              convertedResult.content.push(contentItem);
              continue;
            }

            // 处理 base64 或本地文件
            const imageKey = await this.uploadImageToLark(imageData);
            convertedResult.content.push({
              type: MCPContentType.Text,
              text: `![](${imageKey})`
            });
            logger.info(`已转换图片内容到飞书格式`);
          } catch (error: any) {
            logger.error(`转换图片失败: ${error.message}`);
            // 转换失败，保留原始内容
            convertedResult.content.push(contentItem);
          }
        } else {
          // 其他类型（如 audio）保持不变
          convertedResult.content.push(contentItem);
        }
      }

      return convertedResult;
    } catch (error: any) {
      logger.error(`MCP 图片转换过程出错: ${error.message}`);
      return result; // 出错时返回原始结果
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
