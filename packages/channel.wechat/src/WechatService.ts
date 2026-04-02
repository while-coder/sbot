import crypto from "node:crypto";
import {
  IChannelService, ChannelSessionHandler, SessionService,
  type ChannelMessageArgs, type ILogger, type ActionResult,
} from "channel.base";
import { WechatApiClient } from "./WechatApiClient";
import { WechatSessionHandler } from "./WechatSessionHandler";
import {
  WechatMessageType, WechatMessageItemType, WechatMessageState,
} from "./types";
import type { WeixinMessage, WechatCredentials } from "./types";

export interface WechatMessageArgs extends ChannelMessageArgs {
  messageId: number;
  fromUserId: string;
}

export interface WechatServiceOptions {
  credentials: WechatCredentials;
  logger?: ILogger;
  filterEvent: (eventId: string) => Promise<boolean>;
  onReceiveMessage: (userId: string, args: WechatMessageArgs, query: string) => Promise<void>;
}

export class WechatService implements IChannelService {
  readonly api: WechatApiClient;
  private logger?: ILogger;
  private filterEvent: WechatServiceOptions["filterEvent"];
  private onReceiveMessage: WechatServiceOptions["onReceiveMessage"];

  private _running = false;
  private _abortController?: AbortController;
  private _updatesBuf = "";
  private _lastMessageId = 0;
  /** Map of `botId:userId` → context_token, needed for typing and reply continuity */
  private _contextTokens = new Map<string, string>();
  private _botId: string;

  constructor(options: WechatServiceOptions) {
    this.api = new WechatApiClient(options.credentials);
    this.logger = options.logger;
    this.filterEvent = options.filterEvent;
    this.onReceiveMessage = options.onReceiveMessage;
    this._botId = options.credentials.botId;
  }

  createUserService(session: SessionService): ChannelSessionHandler {
    return new WechatSessionHandler(session, this);
  }

  dispose(): void {
    this._running = false;
    this._abortController?.abort();
  }

  // --- QR Login ---

  private _qrcode?: string;
  private _qrBaseUrl: string = "https://ilinkai.weixin.qq.com";

  async executeAction(action: string, params?: any): Promise<ActionResult> {
    switch (action) {
      case "qrLogin": return this._actionQrLogin(params?.baseUrl);
      case "qrLogin-status": return this._actionQrStatus();
      default: throw new Error(`Unknown action: ${action}`);
    }
  }

  private async _actionQrLogin(baseUrl?: string): Promise<ActionResult> {
    this._qrBaseUrl = baseUrl || this._qrBaseUrl;
    const resp = await WechatApiClient.fetchQRCode(this._qrBaseUrl);
    this._qrcode = resp.qrcode;
    return { qrcodeUrl: resp.qrcode_img_content };
  }

  private async _actionQrStatus(): Promise<ActionResult> {
    if (!this._qrcode) throw new Error("No pending QR code. Call qr-login first.");
    const resp = await WechatApiClient.pollQRStatus(this._qrcode, this._qrBaseUrl);
    if (resp.status === "confirmed") {
      if (!resp.bot_token || !resp.ilink_bot_id || !resp.ilink_user_id) {
        throw new Error("Login confirmed but server returned incomplete data.");
      }
      const credentials: WechatCredentials = {
        botToken: resp.bot_token,
        botId: resp.ilink_bot_id,
        userId: resp.ilink_user_id,
        baseUrl: resp.baseurl || this._qrBaseUrl,
      };
      this._botId = credentials.botId;
      this.api.updateCredentials(credentials);
      this._qrcode = undefined;
      this.connect();
      return {
        status: "confirmed",
        configUpdates: {
          botToken: credentials.botToken,
          botId: credentials.botId,
          userId: credentials.userId,
          baseUrl: credentials.baseUrl,
        },
      };
    }
    if (resp.status === "expired") {
      this._qrcode = undefined;
    }
    return { status: resp.status };
  }

  getContextToken(userId: string): string | undefined {
    return this._contextTokens.get(`${this._botId}:${userId}`);
  }

  // --- Send helpers ---

  async sendTextMessage(toUserId: string, text: string): Promise<void> {
    const contextToken = this.getContextToken(toUserId);
    await this.api.sendMessage({
      msg: {
        from_user_id: "",
        to_user_id: toUserId,
        client_id: `sbot:${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
        message_type: WechatMessageType.BOT,
        message_state: WechatMessageState.FINISH,
        item_list: [{ type: WechatMessageItemType.TEXT, text_item: { text } }],
        context_token: contextToken,
      },
    });
  }

  async sendTypingIndicator(toUserId: string, typing: boolean): Promise<void> {
    const contextToken = this.getContextToken(toUserId);
    if (!contextToken) return; // need context from a prior message
    try {
      const config = await this.api.getConfig(toUserId, contextToken);
      if (!config.typing_ticket) return;
      await this.api.sendTyping({
        ilink_user_id: toUserId,
        typing_ticket: config.typing_ticket,
        status: typing ? 1 : 2,
      });
    } catch (e: any) {
      this.logger?.warn(`sendTyping failed: ${e.message}`);
    }
  }

  // --- Long-polling loop ---

  connect(): void {
    if (this._running) return;
    this._running = true;
    this.pollLoopWithReconnect();
  }

  private pollLoopWithReconnect(): void {
    this.pollLoop().catch((e) => {
      this.logger?.error(`WeChat poll loop crashed: ${e.stack}`);
      if (this._running) {
        this.logger?.info("Reconnecting in 10s...");
        setTimeout(() => {
          if (this._running) this.pollLoopWithReconnect();
        }, 10_000);
      }
    });
  }

  private async pollLoop(): Promise<void> {
    this.logger?.info("WeChat iLink poll loop started");
    this._abortController = new AbortController();
    while (this._running) {
      try {
        const resp = await this.api.getUpdates(this._updatesBuf, this._abortController.signal);

        if (resp.errcode) {
          this.logger?.error(`getUpdates errcode=${resp.errcode} errmsg=${resp.errmsg}`);
          await this.sleep(5000);
          continue;
        }

        if (resp.get_updates_buf) {
          this._updatesBuf = resp.get_updates_buf;
        }

        const newMsgs = (resp.msgs ?? []).filter(
          (m) => m.message_type === WechatMessageType.USER && m.message_id && m.message_id > this._lastMessageId,
        );

        if (newMsgs.length > 0) {
          const maxId = Math.max(...newMsgs.map((m) => m.message_id ?? 0));
          this._lastMessageId = maxId;

          for (const msg of newMsgs) {
            if (msg.context_token && msg.from_user_id) {
              this._contextTokens.set(`${this._botId}:${msg.from_user_id}`, msg.context_token);
            }
            await this.handleIncomingMessage(msg);
          }
        }
      } catch (e: any) {
        if (e?.name === "AbortError") break;
        this.logger?.error(`Poll error: ${e.message}`);
        await this.sleep(3000);
      }
    }
    this.logger?.info("WeChat iLink poll loop stopped");
  }

  private async handleIncomingMessage(msg: WeixinMessage): Promise<void> {
    const fromUserId = msg.from_user_id;
    if (!fromUserId) return;

    const query = this.extractText(msg);
    if (!query) return;

    const eventId = `wechat_message_${msg.message_id}`;
    if (!await this.filterEvent(eventId)) return;

    await this.onReceiveMessage(fromUserId, {
      sessionId: fromUserId, // 1:1 chat, use userId as sessionId
      messageId: msg.message_id ?? 0,
      fromUserId,
    }, query);
  }

  private extractText(msg: WeixinMessage): string {
    const items = msg.item_list ?? [];
    const parts: string[] = [];
    for (const item of items) {
      switch (item.type) {
        case WechatMessageItemType.TEXT: parts.push(item.text_item?.text ?? ""); break;
        case WechatMessageItemType.VOICE: parts.push(item.voice_item?.text ?? ""); break;
        case WechatMessageItemType.FILE: parts.push(item.file_item?.file_name ? `[文件: ${item.file_item.file_name}]` : "[文件]"); break;
        case WechatMessageItemType.IMAGE: parts.push("[图片]"); break;
        case WechatMessageItemType.VIDEO: parts.push("[视频]"); break;
      }
    }
    return parts.join("\n").trim();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
