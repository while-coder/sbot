import crypto from 'node:crypto';
import axios from 'axios';
import type { AuthedAccount, MiConversation, MiNADevice } from './types';

const SID = 'micoapi';
const LOGIN_URL = 'https://account.xiaomi.com/pass/serviceLogin';
const AUTH_URL = 'https://account.xiaomi.com/pass/serviceLoginAuth2';
const MINA_BASE = 'https://api2.mina.mi.com';
const USER_PROFILE_BASE = 'https://userprofile.mina.mi.com';

const PASSPORT_USER_AGENT =
  'Dalvik/2.1.0 (Linux; U; Android 10; RMX2111 Build/QP1A.190711.020) APP/xiaomi.mico APPV/2004040 MK/Uk1YMjExMQ== PassportSDK/3.8.3 passport-ui/3.8.3';
const MIHOME_USER_AGENT =
  'MiHome/6.0.103 (com.xiaomi.mihome; build:6.0.103.1; Android 14) Alamofire/2.0.1 Channel/stable';
const MICO_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 10; 000; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.193 Mobile Safari/537.36 /XiaoMi/HybridView/ micoSoundboxApp/i appVersion/A_2.4.40';

const DEFAULT_CHUNK_LIMIT = 200;
const CHUNK_DELAY_MS = 200;

export enum XiaoaiAuthMode {
  Password = 'password',
  PassToken = 'passToken',
}

export interface XiaoaiAPIOptions {
  userId: string;
  authMode: XiaoaiAuthMode;
  credential: string;
  deviceId?: string;
}

export interface XiaoaiSpeakOptions {
  chunkLimit?: number;
  volume?: number;
}

function md5(str: string): string {
  return crypto.createHash('md5').update(str).digest('hex').toUpperCase();
}

function sha1(str: string): string {
  return crypto.createHash('sha1').update(str).digest('base64');
}

function randomDeviceId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 16; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function parseAuthResponse(text: string): any {
  const cleaned = text
    .replace('&&&START&&&', '')
    .replace(/:(\d{9,})/g, ':"$1"');
  return JSON.parse(cleaned);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkText(text: string, limit: number = DEFAULT_CHUNK_LIMIT): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }

    let splitAt = -1;
    const minSplit = Math.floor(limit * 0.5);

    const newlineIdx = remaining.lastIndexOf('\n', limit);
    if (newlineIdx >= minSplit) {
      splitAt = newlineIdx + 1;
    }

    if (splitAt === -1) {
      const punctuation = ['。', '！', '？', '；', '.', '!', '?', ';', '，', ','];
      for (const p of punctuation) {
        const idx = remaining.lastIndexOf(p, limit);
        if (idx >= minSplit) {
          splitAt = idx + 1;
          break;
        }
      }
    }

    if (splitAt === -1) {
      splitAt = limit;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  return chunks;
}

export class XiaoaiAPI {
  private authed?: AuthedAccount;
  private speakerDeviceId = '';

  constructor(private options: XiaoaiAPIOptions) {}

  setSpeakerDeviceId(deviceId: string): void {
    this.speakerDeviceId = deviceId;
  }

  async getDeviceList(): Promise<MiNADevice[]> {
    const resp = await axios.get(`${MINA_BASE}/admin/v2/device_list`, {
      params: { master: 1 },
      headers: this.minaHeaders(await this.auth()),
    });
    return resp.data?.data ?? [];
  }

  async getConversations(
    hardware: string,
    limit = 2,
  ): Promise<MiConversation[]> {
    if (!this.speakerDeviceId) return [];

    const account = await this.auth();
    const cookie = `userId=${account.userId}; serviceToken=${account.serviceToken}; deviceId=${this.speakerDeviceId}`;
    const resp = await axios.get(`${USER_PROFILE_BASE}/device_profile/v2/conversation`, {
      params: {
        source: 'dialogu',
        hardware,
        limit,
        requestId: crypto.randomUUID(),
      },
      headers: {
        'User-Agent': MICO_USER_AGENT,
        Referer: 'https://userprofile.mina.mi.com/dialogue-note/index.html',
        Cookie: cookie,
      },
    });

    let payload: any = resp.data?.data;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch {
        return [];
      }
    }
    return payload?.records ?? [];
  }

  async speak(
    text: string,
    options?: XiaoaiSpeakOptions,
  ): Promise<void> {
    if (!this.speakerDeviceId) return;

    if (options?.volume) {
      await this.setVolume(this.speakerDeviceId, options.volume);
    }

    const chunks = chunkText(text, options?.chunkLimit ?? DEFAULT_CHUNK_LIMIT);
    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) await sleep(CHUNK_DELAY_MS);
      await this.textToSpeech(this.speakerDeviceId, chunks[i]);
    }
  }

  private async auth(): Promise<AuthedAccount> {
    if (this.authed) return this.authed;

    const { userId, authMode, credential } = this.options;
    const deviceId = this.options.deviceId || randomDeviceId();
    const password = authMode === XiaoaiAuthMode.Password ? credential : '';
    const passToken = authMode === XiaoaiAuthMode.PassToken ? credential : undefined;
    const cookies = this.passportCookies(deviceId, passToken);

    const step1 = await axios.get(LOGIN_URL, {
      params: { sid: SID, _json: 'true', _locale: 'zh_CN' },
      headers: { 'User-Agent': PASSPORT_USER_AGENT, Cookie: cookies },
      transformResponse: [(data) => data],
    });
    let pass = parseAuthResponse(step1.data);

    if (pass.code !== 0) {
      if (!password) {
        throw new Error('XiaoAi login failed: password required for re-authentication');
      }
      const formData = new URLSearchParams({
        _json: 'true',
        qs: pass.qs,
        sid: SID,
        _sign: pass._sign,
        callback: pass.callback,
        user: userId,
        hash: md5(password),
      });

      const step2 = await axios.post(AUTH_URL, formData.toString(), {
        headers: {
          'User-Agent': PASSPORT_USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: cookies,
        },
        transformResponse: [(data) => data],
      });
      pass = parseAuthResponse(step2.data);
    }

    if (pass.location?.includes('identity/authStart')) {
      throw new Error('XiaoAi login failed: verification code required, check passToken');
    }

    if (!pass.location || !pass.nonce || !pass.ssecurity) {
      throw new Error(`XiaoAi login failed: ${pass.description || pass.desc || 'invalid credentials'}`);
    }

    const clientSign = sha1(`nonce=${pass.nonce}&${pass.ssecurity}`);
    const tokenUrl = `${pass.location}&clientSign=${encodeURIComponent(clientSign)}`;
    const serviceToken = await this.resolveServiceToken(tokenUrl);
    this.authed = { userId, serviceToken, deviceId };
    return this.authed;
  }

  private async resolveServiceToken(tokenUrl: string): Promise<string> {
    let nextUrl: string | null = tokenUrl;
    while (nextUrl) {
      const resp: { headers: Record<string, any>; status: number } = await axios.get(nextUrl, {
        headers: { 'User-Agent': PASSPORT_USER_AGENT },
        maxRedirects: 0,
        validateStatus: () => true,
      });
      const setCookies: string[] = resp.headers['set-cookie'] || [];
      for (const c of setCookies) {
        const match = c.match(/serviceToken=([^;]+)/);
        if (match) return match[1];
      }
      const redirect: string | undefined = resp.headers['location'];
      nextUrl = resp.status >= 300 && resp.status < 400 && redirect ? redirect : null;
    }
    throw new Error('XiaoAi login failed: serviceToken not found in cookies');
  }

  private async textToSpeech(speakerDeviceId: string, text: string): Promise<void> {
    await axios.post(
      `${MINA_BASE}/remote/ubus`,
      new URLSearchParams({
        deviceId: speakerDeviceId,
        path: 'mibrain',
        method: 'text_to_speech',
        message: JSON.stringify({ text, save: 0 }),
      }).toString(),
      {
        headers: {
          ...this.minaHeaders(await this.auth()),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );
  }

  private async setVolume(speakerDeviceId: string, volume: number): Promise<void> {
    await axios.post(
      `${MINA_BASE}/remote/ubus`,
      new URLSearchParams({
        deviceId: speakerDeviceId,
        path: 'mediaplayer',
        method: 'player_set_volume',
        message: JSON.stringify({ volume, media: 'app_ios' }),
      }).toString(),
      {
        headers: {
          ...this.minaHeaders(await this.auth()),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );
  }

  private passportCookies(deviceId: string, passToken?: string): string {
    const parts = [
      `userId=${this.options.userId}`,
      `deviceId=${deviceId}`,
      'sdkVersion=3.9',
    ];
    if (passToken) {
      parts.push(`passToken=${passToken}`);
    }
    return parts.join('; ');
  }

  private minaHeaders(account: AuthedAccount): Record<string, string> {
    return {
      'User-Agent': MIHOME_USER_AGENT,
      Cookie: `userId=${account.userId}; serviceToken=${account.serviceToken}; deviceId=${account.deviceId}`,
    };
  }
}
