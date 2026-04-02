import {
  ChannelPlugin, ChannelPluginContext, IChannelService, ConfigFieldType, ActionResultType,
} from "channel.base";
import { WechatService } from "./WechatService";
import type { WechatMessageArgs } from "./WechatService";

function buildWechatExtraInfo(userId: string): string {
  if (!userId) return "";
  return `<wechat-user>
  <userid>${userId}</userid>
</wechat-user>`;
}

export const wechatPlugin: ChannelPlugin = {
  type: "wechat",

  configSchema: {
    qrLogin:  { label: "生成二维码", type: ConfigFieldType.Action, actionResultType: ActionResultType.QR, description: "扫码登录后自动填入以下凭证" },
    botToken: { label: "Bot Token", type: ConfigFieldType.String, required: false, description: "iLink Bot API token（扫码登录自动获取）" },
    botId:    { label: "Bot ID",    type: ConfigFieldType.String, required: false, description: "iLink Bot ID（扫码登录自动获取）" },
    userId:   { label: "User ID",   type: ConfigFieldType.String, required: false, description: "iLink User ID（扫码登录自动获取）" },
    baseUrl:  { label: "Base URL",  type: ConfigFieldType.String, required: false, description: "iLink API base URL", default: "https://ilinkai.weixin.qq.com" },
  },

  async init(ctx: ChannelPluginContext): Promise<IChannelService | undefined> {
    const { config, logger, filterEvent, initSession, onReceiveMessage } = ctx;

    const hasCredentials = config.botToken?.trim() && config.botId?.trim();
    const baseUrl = config.baseUrl?.trim() || "https://ilinkai.weixin.qq.com";

    const service = new WechatService({
      credentials: {
        botToken: config.botToken ?? "",
        botId: config.botId ?? "",
        userId: config.userId ?? "",
        baseUrl,
      },
      logger,
      filterEvent,
      onReceiveMessage: async (userId: string, args: WechatMessageArgs, query: string) => {
        const session = await initSession({
          userId,
          userName: userId,
          userInfo: JSON.stringify({ userid: userId }),
          sessionId: args.sessionId,
          sessionName: args.sessionId,
          sendUpdate: (msg: string) => service.sendTextMessage(userId, msg).then(() => {}),
        });
        await onReceiveMessage(session, query, { ...args, extraInfo: buildWechatExtraInfo(userId) });
      },
    });

    // Only connect if credentials are already configured; otherwise wait for QR login
    if (hasCredentials) {
      service.connect();
    }

    return service;
  },

  async dispose(): Promise<void> {
    // Service disposal handled by ChannelManager calling service.dispose()
  },
};
