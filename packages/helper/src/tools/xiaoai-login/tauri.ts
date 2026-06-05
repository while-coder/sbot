import { invoke } from '@tauri-apps/api/core'

export interface XiaoaiCreds {
  userId: string
  passToken: string
  deviceId: string
}

export interface XiaoaiDevice {
  deviceID: string
  miotDID: string
  name: string
  alias: string
}

export async function openLogin(): Promise<XiaoaiCreds> {
  return await invoke('xiaoai_open_login')
}

export async function logout(): Promise<void> {
  await invoke('xiaoai_logout')
}

export async function listDevices(creds: XiaoaiCreds): Promise<XiaoaiDevice[]> {
  return await invoke('xiaoai_list_devices', { ...creds })
}
