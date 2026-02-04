import * as Lark from "@larksuiteoapi/node-sdk";
import {Util} from "weimingcommons";
import {UserService} from "./UserService";
import log4js from "log4js";
import {database} from "../Database";
import {Op} from "sequelize";
import {config} from "../Config";

const logger = log4js.getLogger("LarkService.ts");

const HourMilliseconds = 1000 * 60 * 60;
const CheckInterval = HourMilliseconds;
const ExpireTime = HourMilliseconds * 24 * 3;


class LarkService {
  private checkTime = 0;
  private larkClient!: Lark.Client;
  private larkWsClient!: Lark.WSClient;

  async start() {
    // 验证配置
    config.validateConfig();

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

  async registerEventDispatcher() {
    const eventDispatcher = new Lark.EventDispatcher({}).register({
      "im.message.receive_v1": async (data: any) => {
        try {
          const {
            event_id,
            message: { chat_type, message_type, chat_id, content, mentions },
            sender: {
              sender_id: { user_id },
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

          const userService = UserService.getUserAgentService(user_id);
          userService.onReceiveMessage(chat_type, chat_id, query.trim()).then(() => {})
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

          const agentService = UserService.getUserAgentService(user_id);
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
