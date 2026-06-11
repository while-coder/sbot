import crypto from 'node:crypto';
import axios from 'axios';
import type { AuthedAccount, MiNADevice, MiConversation } from './types';

const MINA_BASE = 'https://api2.mina.mi.com';
const USER_PROFILE_BASE = 'https://userprofile.mina.mi.com';
const USER_AGENT =
  'MiHome/6.0.103 (com.xiaomi.mihome; build:6.0.103.1; Android 14) Alamofire/2.0.1 Channel/stable';

// 小爱音箱 App 的 UA —— /device_profile/v2/conversation 这个接口按 UA 过滤，
// 必须用 micoSoundboxApp，米家 UA 拿不到对话历史。
const MICO_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 10; 000; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.193 Mobile Safari/537.36 /XiaoMi/HybridView/ micoSoundboxApp/i appVersion/A_2.4.40';

function buildCookies(account: AuthedAccount): string {
  return `userId=${account.userId}; serviceToken=${account.serviceToken}; deviceId=${account.deviceId}`;
}

function headers(account: AuthedAccount): Record<string, string> {
  return {
    'User-Agent': USER_AGENT,
    Cookie: buildCookies(account),
  };
}

export async function getDeviceList(account: AuthedAccount): Promise<MiNADevice[]> {
  const resp = await axios.get(`${MINA_BASE}/admin/v2/device_list`, {
    params: { master: 1 },
    headers: headers(account),
  });
  return resp.data?.data ?? [];
}

export async function getConversations(
  account: AuthedAccount,
  hardware: string,
  speakerDeviceId: string,
  limit = 2,
): Promise<MiConversation[]> {
  // Cookie 里的 deviceId 必须是【音箱的 deviceID】，不是登录用的 session deviceId。
  const cookie = `userId=${account.userId}; serviceToken=${account.serviceToken}; deviceId=${speakerDeviceId}`;
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
  console.log(`[XiaoAi getConversations] hardware=${hardware}, speakerDeviceId=${speakerDeviceId}, raw response:`, JSON.stringify(resp.data));

  let payload: any = resp.data?.data;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch (e) {
      console.error('[XiaoAi getConversations] failed to parse data string:', e);
      return [];
    }
  }
  const records: MiConversation[] = payload?.records ?? [];
  console.log(`[XiaoAi getConversations] parsed: bitSet=${JSON.stringify(payload?.bitSet)}, records.length=${records.length}`);
  return records;
}

export async function textToSpeech(
  account: AuthedAccount,
  deviceId: string,
  text: string,
): Promise<void> {
  await axios.post(
    `${MINA_BASE}/remote/ubus`,
    new URLSearchParams({
      deviceId,
      path: 'mibrain',
      method: 'text_to_speech',
      message: JSON.stringify({ text, save: 0 }),
    }).toString(),
    {
      headers: {
        ...headers(account),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    },
  );
}

export async function setVolume(
  account: AuthedAccount,
  deviceId: string,
  volume: number,
): Promise<void> {
  await axios.post(
    `${MINA_BASE}/remote/ubus`,
    new URLSearchParams({
      deviceId,
      path: 'mediaplayer',
      method: 'player_set_volume',
      message: JSON.stringify({ volume, media: 'app_ios' }),
    }).toString(),
    {
      headers: {
        ...headers(account),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    },
  );
}

export function findDeviceByName(devices: MiNADevice[], name: string): MiNADevice | undefined {
  return devices.find((d) => d.name === name || d.alias === name);
}
