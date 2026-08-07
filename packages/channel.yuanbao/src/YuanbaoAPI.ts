import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import axios from 'axios';
import type { ILogger } from 'channel.base';
import type { YuanbaoMessageElement } from './YuanbaoCodec';

const API_BASE = 'https://bot.yuanbao.tencent.com';
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const SIGN_MAX_RETRIES = 3;

export interface YuanbaoAPIOptions {
  appId: string;
  appSecret: string;
  logger?: ILogger;
}

export interface YuanbaoToken {
  botId: string;
  token: string;
  source: string;
  duration: number;
}

export interface YuanbaoDownloadedMedia {
  data: Buffer;
  mimeType: string;
}

interface YuanbaoAuthHeaders extends Record<string, string> {
  'X-ID': string;
  'X-Token': string;
  'X-Source': string;
}

interface CosUploadConfig {
  bucketName: string;
  region: string;
  location: string;
  secretId: string;
  secretKey: string;
  token: string;
  startTime: number;
  expiredTime: number;
  resourceUrl: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function guessMime(fileName: string): string {
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
    '.webp': 'image/webp', '.bmp': 'image/bmp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
    '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.silk': 'audio/silk',
    '.amr': 'audio/amr', '.mp4': 'video/mp4', '.pdf': 'application/pdf',
    '.txt': 'text/plain', '.zip': 'application/zip',
  };
  return map[path.extname(fileName).toLowerCase()] ?? 'application/octet-stream';
}

function strictEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function hmacSha1(key: string, message: string): string {
  return createHmac('sha1', key).update(message).digest('hex');
}

function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}

function signCosRequest(config: CosUploadConfig, headers: Record<string, string>): string {
  const keyTime = `${config.startTime};${config.expiredTime}`;
  const signKey = hmacSha1(config.secretKey, keyTime);
  const keys = Object.keys(headers).map(key => key.toLowerCase()).sort();
  const headerList = keys.join(';');
  const httpHeaders = keys.map(key => {
    const original = Object.keys(headers).find(candidate => candidate.toLowerCase() === key)!;
    return `${key}=${strictEncode(headers[original])}`;
  }).join('&');
  const pathname = config.location.startsWith('/') ? config.location : `/${config.location}`;
  const httpString = `put\n${pathname}\n\n${httpHeaders}\n`;
  const stringToSign = `sha1\n${keyTime}\n${sha1(httpString)}\n`;
  return [
    'q-sign-algorithm=sha1', `q-ak=${config.secretId}`, `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`, `q-header-list=${headerList}`, 'q-url-param-list=',
    `q-signature=${hmacSha1(signKey, stringToSign)}`,
  ].join('&');
}

function imageSize(data: Buffer): { width: number; height: number } {
  if (data.length >= 24 && data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    while (offset < data.length - 9) {
      if (data[offset] !== 0xff) { offset++; continue; }
      const marker = data[offset + 1];
      if (marker === 0xc0 || marker === 0xc2) {
        return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
      }
      if (offset + 3 >= data.length) break;
      offset += 2 + data.readUInt16BE(offset + 2);
    }
  }
  return { width: 0, height: 0 };
}

/** 元宝 REST API：令牌生命周期、媒体下载解析及 COS 上传。 */
export class YuanbaoAPI {
  private cachedToken?: YuanbaoToken;
  private tokenExpiresAt = 0;
  private tokenRequest?: Promise<YuanbaoToken>;

  constructor(private readonly options: YuanbaoAPIOptions) {}

  invalidateToken(): void {
    this.cachedToken = undefined;
    this.tokenExpiresAt = 0;
  }

  async getToken(): Promise<YuanbaoToken> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) return this.cachedToken;
    if (this.tokenRequest) return this.tokenRequest;
    this.tokenRequest = this.fetchToken().finally(() => { this.tokenRequest = undefined; });
    return this.tokenRequest;
  }

  async downloadMedia(rawUrl: string, fileName: string): Promise<YuanbaoDownloadedMedia> {
    const url = await this.resolveDownloadUrl(rawUrl);
    const response = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 30_000,
      maxContentLength: MAX_MEDIA_BYTES,
    });
    const data = Buffer.from(response.data);
    if (data.length > MAX_MEDIA_BYTES) throw new Error('media exceeds Yuanbao 20 MB limit');
    const contentType = String(response.headers['content-type'] ?? '').split(';')[0];
    return { data, mimeType: contentType || guessMime(fileName) };
  }

  async uploadMedia(file: string | Buffer, requestedName?: string): Promise<YuanbaoMessageElement> {
    const data = Buffer.isBuffer(file) ? file : await fs.readFile(file);
    if (data.length > MAX_MEDIA_BYTES) {
      throw new Error(`File exceeds Yuanbao 20 MB limit (${data.length} bytes)`);
    }
    const fileName = requestedName || (typeof file === 'string' ? path.basename(file) : 'file');
    const mimeType = guessMime(fileName);
    const config = await this.getUploadConfig(fileName);
    await this.uploadToCos(config, data, mimeType);

    const uuid = createHash('md5').update(data).digest('hex');
    if (mimeType.startsWith('image/')) {
      const { width, height } = imageSize(data);
      return {
        msgType: 'TIMImageElem',
        msgContent: {
          uuid,
          imageFormat: 255,
          imageInfoArray: [{ type: 1, size: data.length, width, height, url: config.resourceUrl }],
        },
      };
    }
    return {
      msgType: 'TIMFileElem',
      msgContent: { uuid, fileName, fileSize: data.length, url: config.resourceUrl },
    };
  }

  private async fetchToken(): Promise<YuanbaoToken> {
    for (let attempt = 0; attempt <= SIGN_MAX_RETRIES; attempt++) {
      const nonce = randomBytes(16).toString('hex');
      const timestamp = `${new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 19)}+08:00`;
      const plain = nonce + timestamp + this.options.appId + this.options.appSecret;
      const signature = createHmac('sha256', this.options.appSecret).update(plain).digest('hex');
      let result: any;
      try {
        const response = await axios.post(`${API_BASE}/api/v5/robotLogic/sign-token`, {
          app_key: this.options.appId,
          nonce,
          signature,
          timestamp,
        }, { timeout: 15_000, headers: { 'Content-Type': 'application/json' } });
        result = response.data;
      } catch (error) {
        if (attempt === SIGN_MAX_RETRIES) throw error;
        this.options.logger?.warn(`Yuanbao sign-token network retry ${attempt + 1}/${SIGN_MAX_RETRIES}`);
        await sleep(1_000);
        continue;
      }

      if (result?.code === 0) {
        const data = result.data ?? {};
        const token: YuanbaoToken = {
          botId: data.bot_id ?? '',
          token: data.token ?? '',
          source: data.source ?? 'bot',
          duration: Number(data.duration ?? 0),
        };
        if (!token.botId || !token.token) throw new Error('sign-token returned empty bot_id/token');
        this.cachedToken = token;
        this.tokenExpiresAt = Date.now() + Math.max(60, token.duration - 300) * 1_000;
        return token;
      }
      if (result?.code !== 10099 || attempt === SIGN_MAX_RETRIES) {
        throw new Error(`sign-token error: code=${result?.code}, msg=${result?.msg ?? ''}`);
      }
      this.options.logger?.warn(`Yuanbao sign-token retry ${attempt + 1}/${SIGN_MAX_RETRIES}`);
      await sleep(1_000);
    }
    throw new Error('sign-token failed');
  }

  private async getAuthHeaders(): Promise<YuanbaoAuthHeaders> {
    const token = await this.getToken();
    return { 'X-ID': token.botId, 'X-Token': token.token, 'X-Source': token.source };
  }

  private async resolveDownloadUrl(rawUrl: string): Promise<string> {
    let resourceId: string | null;
    try { resourceId = new URL(rawUrl).searchParams.get('resourceId'); }
    catch { return rawUrl; }
    if (!resourceId) return rawUrl;

    try {
      const response = await axios.get(`${API_BASE}/api/resource/v1/download`, {
        params: { resourceId },
        headers: await this.getAuthHeaders(),
        timeout: 15_000,
      });
      return response.data?.data?.url
        ?? response.data?.data?.realUrl
        ?? response.data?.url
        ?? response.data?.realUrl
        ?? rawUrl;
    } catch (error: any) {
      this.options.logger?.warn(`Yuanbao download URL resolve failed: ${error?.message ?? error}`);
      return rawUrl;
    }
  }

  private async getUploadConfig(fileName: string): Promise<CosUploadConfig> {
    const response = await axios.post(`${API_BASE}/api/resource/genUploadInfo`, {
      fileName,
      fileId: randomUUID().replace(/-/g, ''),
      docFrom: 'localDoc',
      docOpenId: '',
    }, { headers: await this.getAuthHeaders(), timeout: 15_000 });
    const data = response.data?.data ?? response.data;
    if (!data?.bucketName || !data?.location) throw new Error('genUploadInfo returned incomplete data');
    return {
      bucketName: data.bucketName,
      region: data.region ?? '',
      location: data.location,
      secretId: data.encryptTmpSecretId ?? '',
      secretKey: data.encryptTmpSecretKey ?? '',
      token: data.encryptToken ?? '',
      startTime: Number(data.startTime ?? Math.floor(Date.now() / 1_000)),
      expiredTime: Number(data.expiredTime ?? Math.floor(Date.now() / 1_000) + 1_800),
      resourceUrl: data.resourceUrl ?? '',
    };
  }

  private async uploadToCos(config: CosUploadConfig, data: Buffer, mimeType: string): Promise<void> {
    const pathname = config.location.startsWith('/') ? config.location : `/${config.location}`;
    const host = `${config.bucketName}.cos.${config.region}.myqcloud.com`;
    const signHeaders: Record<string, string> = { host, 'content-length': String(data.length) };
    if (config.token) signHeaders['x-cos-security-token'] = config.token;
    const headers: Record<string, string> = {
      Authorization: signCosRequest(config, signHeaders),
      'Content-Length': String(data.length),
      'Content-Type': mimeType.startsWith('image/') ? mimeType : 'application/octet-stream',
    };
    if (config.token) headers['x-cos-security-token'] = config.token;
    if (mimeType.startsWith('image/')) {
      headers['Pic-Operations'] = JSON.stringify({
        is_pic_info: 1,
        rules: [{ fileid: config.location, rule: 'imageMogr2/format/jpg' }],
      });
    }
    await axios.put(`https://${host}${pathname}`, data, {
      headers,
      timeout: 30_000,
      maxBodyLength: MAX_MEDIA_BYTES,
    });
  }
}
