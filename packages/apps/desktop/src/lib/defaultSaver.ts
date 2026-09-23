import { api } from './api'

/**
 * 桌面端「专用存储」：聊天记录统一落在 FileSaver（JSON 文件）里，
 * 桌面 UI 不再暴露存储选择。每次启动按 name 查找/创建（存在则原样复用，
 * 保留用户数据所在的存储），并把 Web 渠道默认 saver 指向它。
 */

export const DESKTOP_SAVER_NAME = '桌面存储'

export interface SaverEntry {
  name?: string
  type?: string
  config?: Record<string, unknown>
  [key: string]: unknown
}

/** 在 savers 里按名字定位桌面专用存储的 id；不存在返回 undefined */
export function findDesktopSaverId(savers: Record<string, SaverEntry> | undefined): string | undefined {
  return Object.entries(savers ?? {}).find(([, s]) => s.name === DESKTOP_SAVER_NAME)?.[0]
}

/**
 * 确保桌面专用存储存在，且 Web 渠道默认 saver 指向它。
 * 无可用存储时兜底创建（FileSaver 无外部依赖，总能成功）。
 */
export async function ensureBuiltinSaver(): Promise<void> {
  try {
    const settings = await api.get<{
      savers?: Record<string, SaverEntry>
      channels?: Record<string, { saver?: string } & Record<string, unknown>>
    }>('/api/settings')
    let saverId = findDesktopSaverId(settings?.savers)

    if (!saverId) {
      // POST 返回全量 settings（含新 savers map），据此拿自动生成的 id
      const after = await api.post<{ savers?: Record<string, SaverEntry> }>('/api/settings/savers', {
        name: DESKTOP_SAVER_NAME,
        type: 'file',
        config: {},
      })
      saverId = findDesktopSaverId(after?.savers)
    }
    if (!saverId) return

    const web = settings?.channels?.web
    if (web && web.saver !== saverId) {
      // PUT 是整体替换：带回原字段，只改 saver
      await api.put('/api/settings/channels/web', { ...web, saver: saverId })
    }
  } catch (e) {
    console.error('[defaultSaver] ensureBuiltinSaver failed:', e)
  }
}
