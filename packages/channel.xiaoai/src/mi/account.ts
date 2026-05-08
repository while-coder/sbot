import crypto from 'node:crypto';
import axios from 'axios';
import type { MiAccount, AuthedAccount } from './types';

const SID = 'micoapi';
const LOGIN_URL = 'https://account.xiaomi.com/pass/serviceLogin';
const AUTH_URL = 'https://account.xiaomi.com/pass/serviceLoginAuth2';
const USER_AGENT =
  'MiHome/6.0.103 (com.xiaomi.mihome; build:6.0.103.1; Android 14) Alamofire/2.0.1 Channel/stable';

function md5(str: string): string {
  return crypto.createHash('md5').update(str).digest('hex').toUpperCase();
}

function sha1(str: string): string {
  return crypto.createHash('sha1').update(str).digest('hex');
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
  const cleaned = text.replace('&&&START&&&', '');
  return JSON.parse(cleaned);
}

export async function login(account: MiAccount): Promise<AuthedAccount> {
  const deviceId = account.deviceId || randomDeviceId();
  const cookies = `userId=${account.userId}; deviceId=${deviceId}`;

  const step1 = await axios.get(LOGIN_URL, {
    params: { sid: SID, _json: 'true', _locale: 'zh_CN' },
    headers: { 'User-Agent': USER_AGENT, Cookie: cookies },
    transformResponse: [(data) => data],
  });
  const challenge = parseAuthResponse(step1.data);

  const formData = new URLSearchParams({
    _json: 'true',
    qs: challenge.qs,
    sid: SID,
    _sign: challenge._sign,
    callback: challenge.callback,
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
  const authResult = parseAuthResponse(step2.data);

  if (!authResult.location) {
    throw new Error(`XiaoAi login failed: ${authResult.desc || 'unknown error'}`);
  }

  const nonce = authResult.nonce;
  const ssecurity = authResult.ssecurity;
  const clientSign = sha1(`nonce=${nonce}&${ssecurity}`);
  const tokenUrl = `${authResult.location}&clientSign=${encodeURIComponent(clientSign)}`;

  const step3 = await axios.get(tokenUrl, {
    headers: { 'User-Agent': USER_AGENT },
    maxRedirects: 0,
    validateStatus: (s) => s >= 200 && s < 400,
  });

  const setCookies: string[] = step3.headers['set-cookie'] || [];
  let serviceToken = '';
  for (const c of setCookies) {
    const match = c.match(/serviceToken=([^;]+)/);
    if (match) {
      serviceToken = match[1];
      break;
    }
  }

  if (!serviceToken) {
    throw new Error('XiaoAi login failed: serviceToken not found in cookies');
  }

  return { userId: account.userId, serviceToken, deviceId };
}
