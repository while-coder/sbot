import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  IChannelService, ChannelSessionHandler, SessionService,
  readImageAsDataUrl, isEmptyContent,
  type ChannelMessageArgs, type ILogger, type MessageContent,
} from "channel.base";
import { WechatApiClient } from "./WechatApiClient";
import { WechatSessionHandler } from "./WechatSessionHandler";
import {
  WechatMessageType, WechatMessageItemType, WechatMessageState,
  UploadMediaType,
} from "./types";
import type { WeixinMessage, WechatMessageItem, WechatCredentials, CDNMedia } from "./types";


export interface WechatMessageArgs extends ChannelMessageArgs {
  messageId: number;
  fromUserId: string;
}

export interface WechatServiceOptions {
  credentials: WechatCredentials;
  logger?: ILogger;
  filterEvent: (eventId: string) => Promise<boolean>;
  onReceiveMessage: (userId: string, args: WechatMessageArgs, query: MessageContent) => Promise<void>;
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
  private _contextTokens = new Map<string, string>();
  private _botId: string;

  constructor(options: WechatServiceOptions) {
    this.api = new WechatApiClient(options.credentials);
    this.logger = options.logger;
    this.filterEvent = options.filterEvent;
    this.onReceiveMessage = options.onReceiveMessage;
    this._botId = options.credentials.botId;
  }

  createSessionHandler(session: SessionService): ChannelSessionHandler {
    return new WechatSessionHandler(session, this);
  }

  async sendText(sessionId: string, text: string): Promise<void> {
    await this.sendTextMessage(sessionId, text);
  }

  async sendFile(sessionId: string, file: string | Buffer, fileName?: string): Promise<void> {
    await this.sendFileMessage(sessionId, file, fileName);
  }

  async sendNative(_sessionId: string, _payload: any): Promise<void> {}

  dispose(): void {
    this._running = false;
    this._abortController?.abort();
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

  async sendFileMessage(toUserId: string, file: string | Buffer, fileName?: string): Promise<void> {
    const fileBuffer = typeof file === "string" ? await fs.readFile(file) : file;
    fileName ??= typeof file === "string" ? path.basename(file) : undefined;
    if (!fileName) throw new Error("fileName is required when file is a Buffer");

    // Generate random 16-byte AES key
    const aesKeyBuf = crypto.randomBytes(16);
    const aesKeyHex = aesKeyBuf.toString("hex"); // 32 hex chars

    // AES-128-ECB encrypt with PKCS7 padding
    const cipher = crypto.createCipheriv("aes-128-ecb", aesKeyBuf, null);
    const encrypted = Buffer.concat([cipher.update(fileBuffer), cipher.final()]);

    const rawMd5 = crypto.createHash("md5").update(fileBuffer).digest("hex");
    const filekey = crypto.randomBytes(16).toString("hex");

    // Step 1: get upload URL params
    const uploadResp = await this.api.getUploadUrl({
      filekey,
      media_type: UploadMediaType.FILE,
      to_user_id: toUserId,
      rawsize: fileBuffer.length,
      rawfilemd5: rawMd5,
      filesize: encrypted.length,
      no_need_thumb: true,
      aeskey: aesKeyHex,
    });

    if (!uploadResp.upload_param) {
      throw new Error(`getUploadUrl failed: ${uploadResp.errmsg ?? "no upload_param"}`);
    }

    // Step 2: upload encrypted file to CDN
    const encryptQueryParam = await this.api.uploadToCDN(uploadResp.upload_param, filekey, encrypted);

    // Step 3: send message with CDN reference
    const aesKeyBase64 = Buffer.from(aesKeyHex, "utf-8").toString("base64");
    const media: CDNMedia = {
      encrypt_query_param: encryptQueryParam,
      aes_key: aesKeyBase64,
      encrypt_type: 1,
    };

    const contextToken = this.getContextToken(toUserId);
    await this.api.sendMessage({
      msg: {
        from_user_id: "",
        to_user_id: toUserId,
        client_id: `sbot:${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
        message_type: WechatMessageType.BOT,
        message_state: WechatMessageState.FINISH,
        item_list: [{
          type: WechatMessageItemType.FILE,
          file_item: {
            media,
            file_name: fileName,
            md5: rawMd5,
            len: String(fileBuffer.length),
          },
        }],
        context_token: contextToken,
      },
    });
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

    const query = await this.extractContent(msg);
    if (isEmptyContent(query)) return;

    const eventId = `wechat_message_${msg.message_id}`;
    if (!await this.filterEvent(eventId)) return;

    await this.onReceiveMessage(fromUserId, {
      sessionId: fromUserId, // 1:1 chat, use userId as sessionId
      messageId: msg.message_id ?? 0,
      fromUserId,
    }, query);
  }

  private async extractContent(msg: WeixinMessage): Promise<MessageContent> {
    const items = msg.item_list ?? [];
    const parts: Array<{ type: string; text?: string; [key: string]: any }> = [];
    let hasImage = false;

    for (const item of items) {
      if (item.ref_msg?.message_item) {
        const refParts = await this.extractItemParts(msg.message_id, item.ref_msg.message_item, "引用");
        for (const rp of refParts) {
          parts.push(rp);
          if (rp.type === 'image_url') hasImage = true;
        }
      }

      const itemParts = await this.extractItemParts(msg.message_id, item);
      for (const p of itemParts) {
        parts.push(p);
        if (p.type === 'image_url') hasImage = true;
      }
    }
    if (!hasImage) return parts.map(p => p.text!).join("\n").trim();
    return parts;
  }

  private async extractItemParts(messageId: number | undefined, item: WechatMessageItem, label?: string): Promise<Array<{ type: string; [key: string]: any }>> {
    switch (item.type) {
      case WechatMessageItemType.TEXT: {
        const text = item.text_item?.text ?? "";
        return [{ type: 'text', text: label ? `[${label}: ${text}]` : text }];
      }

      case WechatMessageItemType.VOICE: {
        const text = item.voice_item?.text ?? "";
        return [{ type: 'text', text: label ? `[${label}: ${text}]` : text }];
      }

      case WechatMessageItemType.IMAGE: {
        const media = item.image_item?.media;
        const imgFallback = label ? `[${label}: 图片]` : "[图片]";
        if (!media?.encrypt_query_param) return [{ type: 'text', text: imgFallback }];
        try {
          const buffer = await this.api.downloadFromCDN(media.encrypt_query_param, media.aes_key);
          const filePath = path.join(os.tmpdir(), `wechat_${messageId ?? Date.now()}_img`);
          await fs.writeFile(filePath, buffer);
          const dataUrl = await readImageAsDataUrl(filePath);
          const parts: Array<{ type: string; [key: string]: any }> = [];
          if (label) parts.push({ type: 'text', text: imgFallback });
          parts.push({ type: 'image_url', image_url: { url: dataUrl } });
          return parts;
        } catch (e: any) {
          this.logger?.error(`Failed to download image: ${e.message}`);
          return [{ type: 'text', text: imgFallback }];
        }
      }

      case WechatMessageItemType.FILE: {
        const fileName = item.file_item?.file_name ?? "unknown_file";
        const media = item.file_item?.media;
        const fileFallback = label ? `[${label}: 文件 ${fileName}]` : `[文件: ${fileName}]`;
        if (!media?.encrypt_query_param) return [{ type: 'text', text: fileFallback }];
        try {
          const buffer = await this.api.downloadFromCDN(media.encrypt_query_param, media.aes_key);
          const ext = path.extname(fileName);
          const filePath = path.join(os.tmpdir(), `wechat_${messageId ?? Date.now()}${ext}`);
          await fs.writeFile(filePath, buffer);
          const linkText = label ? `[${label}: file ${fileName}](${filePath})` : `[file: ${fileName}](${filePath})`;
          return [{ type: 'text', text: linkText }];
        } catch (e: any) {
          this.logger?.error(`Failed to download file "${fileName}": ${e.message}`);
          return [{ type: 'text', text: fileFallback }];
        }
      }

      case WechatMessageItemType.VIDEO:
        return [{ type: 'text', text: label ? `[${label}: 视频]` : "[视频]" }];

      default:
        return [];
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
