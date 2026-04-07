import crypto from "node:crypto";
import type {
  GetUpdatesResp, SendMessageReq, SendTypingReq, GetConfigResp,
  WechatCredentials, QRCodeResponse, QRStatusResponse,
  GetUploadUrlReq, GetUploadUrlResp,
} from "./types";

const LONG_POLL_TIMEOUT_MS = 30_000;
const API_TIMEOUT_MS = 15_000;
const UPLOAD_TIMEOUT_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
const QR_LONG_POLL_TIMEOUT_MS = 35_000;
const CHANNEL_VERSION = "1.0.0";
const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}

export class WechatApiClient {
  private baseUrl: string;
  private token: string;

  constructor(credentials: WechatCredentials) {
    this.baseUrl = credentials.baseUrl.endsWith("/")
      ? credentials.baseUrl
      : `${credentials.baseUrl}/`;
    this.token = credentials.botToken;
  }

  updateCredentials(credentials: WechatCredentials): void {
    this.baseUrl = credentials.baseUrl.endsWith("/")
      ? credentials.baseUrl
      : `${credentials.baseUrl}/`;
    this.token = credentials.botToken;
  }

  // --- QR Login (static — no token needed) ---

  static async fetchQRCode(baseUrl?: string): Promise<QRCodeResponse> {
    const base = ensureTrailingSlash(baseUrl || DEFAULT_BASE_URL);
    const url = new URL("ilink/bot/get_bot_qrcode?bot_type=3", base);
    const res = await fetch(url.toString());
    if (!res.ok) {
      const body = await res.text().catch(() => "(unreadable)");
      throw new Error(`Failed to fetch QR code: ${res.status} ${body}`);
    }
    return res.json() as Promise<QRCodeResponse>;
  }

  static async pollQRStatus(qrcode: string, baseUrl?: string): Promise<QRStatusResponse> {
    const base = ensureTrailingSlash(baseUrl || DEFAULT_BASE_URL);
    const url = new URL(`ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`, base);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), QR_LONG_POLL_TIMEOUT_MS);
    try {
      const res = await fetch(url.toString(), {
        headers: { "iLink-App-ClientVersion": "1" },
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "(unreadable)");
        throw new Error(`Failed to poll QR status: ${res.status} ${body}`);
      }
      return res.json() as Promise<QRStatusResponse>;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return { status: "wait" };
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private buildHeaders(bodyStr: string): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "AuthorizationType": "ilink_bot_token",
      "Content-Length": String(Buffer.byteLength(bodyStr, "utf-8")),
      "X-WECHAT-UIN": randomWechatUin(),
    };
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }
    return headers;
  }

  private async post(endpoint: string, body: object, timeoutMs: number, externalSignal?: AbortSignal): Promise<string> {
    const bodyStr = JSON.stringify(body);
    const url = new URL(endpoint, this.baseUrl).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onExternalAbort = () => controller.abort();
    externalSignal?.addEventListener("abort", onExternalAbort);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: this.buildHeaders(bodyStr),
        body: bodyStr,
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${endpoint} ${res.status}: ${text}`);
      return text;
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }
  }

  async getUpdates(updatesBuf: string, signal?: AbortSignal): Promise<GetUpdatesResp> {
    try {
      const raw = await this.post("ilink/bot/getupdates", {
        get_updates_buf: updatesBuf,
        base_info: { channel_version: CHANNEL_VERSION },
      }, LONG_POLL_TIMEOUT_MS, signal);
      return JSON.parse(raw);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return { ret: 0, msgs: [], get_updates_buf: updatesBuf };
      }
      throw err;
    }
  }

  async sendMessage(req: SendMessageReq): Promise<void> {
    await this.post("ilink/bot/sendmessage", {
      ...req,
      base_info: { channel_version: CHANNEL_VERSION },
    }, API_TIMEOUT_MS);
  }

  async getConfig(ilinkUserId: string, contextToken?: string): Promise<GetConfigResp> {
    const raw = await this.post("ilink/bot/getconfig", {
      ilink_user_id: ilinkUserId,
      context_token: contextToken,
      base_info: { channel_version: CHANNEL_VERSION },
    }, API_TIMEOUT_MS);
    return JSON.parse(raw);
  }

  async sendTyping(req: SendTypingReq): Promise<void> {
    await this.post("ilink/bot/sendtyping", {
      ...req,
      base_info: { channel_version: CHANNEL_VERSION },
    }, API_TIMEOUT_MS);
  }

  async getUploadUrl(req: GetUploadUrlReq): Promise<GetUploadUrlResp> {
    const raw = await this.post("ilink/bot/getuploadurl", {
      ...req,
      base_info: { channel_version: CHANNEL_VERSION },
    }, API_TIMEOUT_MS);
    return JSON.parse(raw);
  }

  async downloadFromCDN(encryptQueryParam: string, aesKeyBase64?: string): Promise<Buffer> {
    const url = `${CDN_BASE_URL}/download?encrypted_query_param=${encodeURIComponent(encryptQueryParam)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        const text = await res.text().catch(() => "(unreadable)");
        throw new Error(`CDN download failed: ${res.status} ${text}`);
      }
      const encrypted = Buffer.from(await res.arrayBuffer());

      if (!aesKeyBase64) return encrypted;

      // aes_key is base64-encoded hex string → decode to hex → parse to 16-byte key
      const aesKeyHex = Buffer.from(aesKeyBase64, "base64").toString("utf-8");
      const aesKeyBuf = Buffer.from(aesKeyHex, "hex");
      const decipher = crypto.createDecipheriv("aes-128-ecb", aesKeyBuf, null);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]);
    } finally {
      clearTimeout(timer);
    }
  }

  async uploadToCDN(uploadParam: string, filekey: string, encryptedData: Buffer): Promise<string> {
    const url = `${CDN_BASE_URL}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(filekey)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: encryptedData,
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "(unreadable)");
        throw new Error(`CDN upload failed: ${res.status} ${text}`);
      }
      const encryptQueryParam = res.headers.get("x-encrypted-param");
      if (!encryptQueryParam) {
        throw new Error("CDN upload response missing x-encrypted-param header");
      }
      return encryptQueryParam;
    } finally {
      clearTimeout(timer);
    }
  }
}
