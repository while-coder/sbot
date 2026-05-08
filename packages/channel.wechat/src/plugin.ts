import {
  ChannelPlugin, ChannelPluginContext, IChannelService, ConfigFieldType,
  type MessageContent,
} from "channel.base";
import { WechatApiClient } from "./WechatApiClient";
import { WechatService } from "./WechatService";
import type { WechatMessageArgs } from "./WechatService";
import type { WechatCredentials } from "./types";

function buildWechatExtraInfo(userId: string): string {
  if (!userId) return "";
  return `<wechat-user>
  <userid>${userId}</userid>
</wechat-user>`;
}

// QR login state per key (managed at plugin level, before service init)
interface QRState { qrcode: string; baseUrl: string; aborted: boolean }
const _qrState = new Map<string, QRState>();
const QR_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function toQRCodeResult(raw: string): { url: string; type: 'image' | 'link' } {
  if (!raw) return { url: "", type: "link" };
  if (raw.startsWith("data:")) return { url: raw, type: "image" };
  if (raw.startsWith("http")) return { url: raw, type: "link" };
  // Raw base64 data
  return { url: `data:image/png;base64,${raw}`, type: "image" };
}

export const wechatPlugin: ChannelPlugin = {
  type: "wechat",
  label: "微信",

  configSchema: {
    qrLogin:  { label: "扫码登录", type: ConfigFieldType.QRCode, description: "扫码登录后自动填入凭证" },
  },

  async getQRCode(key: string, _params?: any): Promise<{ url: string; type: 'image' | 'link' }> {
    // Abort any previous pending poll for the same key
    const prev = _qrState.get(key);
    if (prev) prev.aborted = true;

    const baseUrl = "https://ilinkai.weixin.qq.com";
    const resp = await WechatApiClient.fetchQRCode(baseUrl);
    _qrState.set(key, { qrcode: resp.qrcode, baseUrl, aborted: false });
    return toQRCodeResult(resp.qrcode_img_content);
  },

  async awaitQRResult(key: string): Promise<Record<string, any> | null> {
    const state = _qrState.get(key);
    if (!state) return null;
    const deadline = Date.now() + QR_TIMEOUT_MS;
    while (state.qrcode && !state.aborted && Date.now() < deadline) {
      const resp = await WechatApiClient.pollQRStatus(state.qrcode, state.baseUrl);
      if (state.aborted) break;
      if (resp.status === "confirmed") {
        _qrState.delete(key);
        if (!resp.bot_token || !resp.ilink_bot_id || !resp.ilink_user_id) {
          throw new Error("Login confirmed but server returned incomplete data.");
        }
        return {
          botToken: resp.bot_token,
          botId: resp.ilink_bot_id,
          userId: resp.ilink_user_id,
        };
      }
      if (resp.status === "expired") {
        _qrState.delete(key);
        return null;
      }
      // "wait" / "scaned" → continue polling
    }
    _qrState.delete(key);
    return null;
  },

  async init(ctx: ChannelPluginContext): Promise<IChannelService | undefined> {
    const { config, logger, filterEvent, initSession, onReceiveMessage } = ctx;

    const cred = config.qrLogin as WechatCredentials | undefined;
    const credentials: WechatCredentials = {
      botToken: cred?.botToken ?? "",
      botId: cred?.botId ?? "",
      userId: cred?.userId ?? "",
      baseUrl: "https://ilinkai.weixin.qq.com",
    };

    const hasCredentials = credentials.botToken && credentials.botId;

    const service = new WechatService({
      credentials,
      logger,
      filterEvent,
      onReceiveMessage: async (userId: string, args: WechatMessageArgs, query: MessageContent) => {
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

    if (hasCredentials) {
      service.connect();
    }

    return service;
  },

  async dispose(): Promise<void> {
    // Service disposal handled by ChannelManager calling service.dispose()
  },
};
