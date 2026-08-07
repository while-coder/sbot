import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import axios from 'axios';
import type { YuanbaoMessageElement } from './YuanbaoCodec';

export interface YuanbaoAuthHeaders extends Record<string, string> {
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

const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

export function guessMime(fileName: string): string {
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
    '.webp': 'image/webp', '.bmp': 'image/bmp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
    '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.silk': 'audio/silk',
    '.amr': 'audio/amr', '.mp4': 'video/mp4',
    '.pdf': 'application/pdf', '.txt': 'text/plain', '.zip': 'application/zip',
  };
  return map[path.extname(fileName).toLowerCase()] ?? 'application/octet-stream';
}

function strictEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
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

async function getUploadConfig(
  apiBase: string,
  headers: YuanbaoAuthHeaders,
  fileName: string,
): Promise<CosUploadConfig> {
  const response = await axios.post(`${apiBase}/api/resource/genUploadInfo`, {
    fileName,
    fileId: randomUUID().replace(/-/g, ''),
    docFrom: 'localDoc',
    docOpenId: '',
  }, { headers, timeout: 15_000 });
  const data = response.data?.data ?? response.data;
  if (!data?.bucketName || !data?.location) throw new Error('genUploadInfo returned incomplete data');
  return {
    bucketName: data.bucketName,
    region: data.region ?? '',
    location: data.location,
    secretId: data.encryptTmpSecretId ?? '',
    secretKey: data.encryptTmpSecretKey ?? '',
    token: data.encryptToken ?? '',
    startTime: Number(data.startTime ?? Math.floor(Date.now() / 1000)),
    expiredTime: Number(data.expiredTime ?? Math.floor(Date.now() / 1000) + 1800),
    resourceUrl: data.resourceUrl ?? '',
  };
}

export async function uploadMedia(
  apiBase: string,
  authHeaders: YuanbaoAuthHeaders,
  file: string | Buffer,
  requestedName?: string,
): Promise<YuanbaoMessageElement> {
  const data = Buffer.isBuffer(file) ? file : await fs.readFile(file);
  if (data.length > MAX_MEDIA_BYTES) throw new Error(`File exceeds Yuanbao 20 MB limit (${data.length} bytes)`);
  const fileName = requestedName || (typeof file === 'string' ? path.basename(file) : 'file');
  const mimeType = guessMime(fileName);
  const config = await getUploadConfig(apiBase, authHeaders, fileName);
  const pathname = config.location.startsWith('/') ? config.location : `/${config.location}`;
  const host = `${config.bucketName}.cos.${config.region}.myqcloud.com`;
  const signHeaders: Record<string, string> = { host, 'content-length': String(data.length) };
  if (config.token) signHeaders['x-cos-security-token'] = config.token;
  const requestHeaders: Record<string, string> = {
    Authorization: signCosRequest(config, signHeaders),
    'Content-Length': String(data.length),
    'Content-Type': mimeType.startsWith('image/') ? mimeType : 'application/octet-stream',
  };
  if (config.token) requestHeaders['x-cos-security-token'] = config.token;
  if (mimeType.startsWith('image/')) {
    requestHeaders['Pic-Operations'] = JSON.stringify({
      is_pic_info: 1,
      rules: [{ fileid: config.location, rule: 'imageMogr2/format/jpg' }],
    });
  }
  await axios.put(`https://${host}${pathname}`, data, {
    headers: requestHeaders,
    timeout: 30_000,
    maxBodyLength: MAX_MEDIA_BYTES,
  });

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
