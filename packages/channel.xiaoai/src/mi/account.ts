import crypto from 'node:crypto';
import axios from 'axios';
import type { MiAccount, AuthedAccount } from './types';

const SID = 'micoapi';
const LOGIN_URL = 'https://account.xiaomi.com/pass/serviceLogin';
const AUTH_URL = 'https://account.xiaomi.com/pass/serviceLoginAuth2';
const USER_AGENT =
  'Dalvik/2.1.0 (Linux; U; Android 10; RMX2111 Build/QP1A.190711.020) APP/xiaomi.mico APPV/2004040 MK/Uk1YMjExMQ== PassportSDK/3.8.3 passport-ui/3.8.3';

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

function buildCookies(account: MiAccount, deviceId: string): string {
  const parts: string[] = [
    `userId=${account.userId}`,
    `deviceId=${deviceId}`,
    'sdkVersion=3.9',
  ];
  if (account.passToken) {
    parts.push(`passToken=${account.passToken}`);
  }
  return parts.join('; ');
}

export async function login(account: MiAccount): Promise<AuthedAccount> {
  const deviceId = account.deviceId || randomDeviceId();
  const cookies = buildCookies(account, deviceId);

  const step1 = await axios.get(LOGIN_URL, {
    params: { sid: SID, _json: 'true', _locale: 'zh_CN' },
    headers: { 'User-Agent': USER_AGENT, Cookie: cookies },
    transformResponse: [(data) => data],
  });
  let pass = parseAuthResponse(step1.data);

  if (pass.code !== 0) {
    if (!account.password) {
      throw new Error('XiaoAi login failed: password required for re-authentication');
    }
    const formData = new URLSearchParams({
      _json: 'true',
      qs: pass.qs,
      sid: SID,
      _sign: pass._sign,
      callback: pass.callback,
      user: account.userId,
      hash: md5(account.password),
    });

    const step2 = await axios.post(AUTH_URL, formData.toString(), {
      headers: {
        'User-Agent': USER_AGENT,
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

  let serviceToken = '';
  let nextUrl: string | null = tokenUrl;
  while (nextUrl) {
    const resp: { headers: Record<string, any>; status: number } = await axios.get(nextUrl, {
      headers: { 'User-Agent': USER_AGENT },
      maxRedirects: 0,
      validateStatus: () => true,
    });
    const setCookies: string[] = resp.headers['set-cookie'] || [];
    for (const c of setCookies) {
      const match = c.match(/serviceToken=([^;]+)/);
      if (match) {
        serviceToken = match[1];
        break;
      }
    }
    if (serviceToken) break;
    const redirect: string | undefined = resp.headers['location'];
    if (resp.status >= 300 && resp.status < 400 && redirect) {
      nextUrl = redirect;
    } else {
      break;
    }
  }

  if (!serviceToken) {
    throw new Error('XiaoAi login failed: serviceToken not found in cookies');
  }

  return { userId: account.userId, serviceToken, deviceId };
}
