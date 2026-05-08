import crypto from 'node:crypto';
import axios from 'axios';
import type { AuthedAccount, MiNADevice, MiConversation } from './types';

const MINA_BASE = 'https://api2.mina.mi.com';
const USER_PROFILE_BASE = 'https://userprofile.mina.mi.com';
const USER_AGENT =
  'MiHome/6.0.103 (com.xiaomi.mihome; build:6.0.103.1; Android 14) Alamofire/2.0.1 Channel/stable';

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
  deviceId: string,
  limit = 2,
): Promise<MiConversation[]> {
  const resp = await axios.get(`${USER_PROFILE_BASE}/device_profile/v2/conversation`, {
    params: {
      source: 'dialogu',
      hardware: deviceId,
      timestamp: 0,
      limit,
      requestId: crypto.randomUUID(),
    },
    headers: headers(account),
  });
  return resp.data?.data?.records ?? [];
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
