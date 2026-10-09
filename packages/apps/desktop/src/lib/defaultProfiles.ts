import { api } from './api'

/**
 * 桌面端「专属记忆 / 日程」：按 name 查找/创建 memoryProfile 与 agendaProfile，
 * 并把 Web 渠道默认 memory / agenda 指向它们。已存在则原样复用（保留用户改动），
 * 仅在 writerModel 缺失时兜底补一个可用模型。无可用模型时跳过（Onboarding 阶段），
 * 等模型配置好后由 modelsEmpty watch / 重启重试。
 */

export const DESKTOP_MEMORY_NAME = '桌面记忆'
export const DESKTOP_AGENDA_NAME = '桌面日程'

export interface MemoryProfileEntry {
  name?: string
  enabled?: boolean
  writerModel?: string
  [key: string]: unknown
}

export interface AgendaProfileEntry {
  name?: string
  enabled?: boolean
  syncModel?: string
  [key: string]: unknown
}

function findByName<T>(map: Record<string, T> | undefined, name: string): string | undefined {
  return Object.entries(map ?? {}).find(([, v]) => (v as { name?: string })?.name === name)?.[0]
}

/**
 * 确保桌面专属记忆 / 日程存在，且 Web 渠道默认 memory / agenda 指向它们。
 * 返回是否完成（无可用模型时返回 false，等待重试）。
 */
export async function ensureBuiltinProfiles(): Promise<boolean> {
  try {
    const settings = await api.get<{
      models?: Record<string, unknown>
      agents?: Record<string, { model?: string }>
      memoryProfiles?: Record<string, MemoryProfileEntry>
      agendaProfiles?: Record<string, AgendaProfileEntry>
      channels?: Record<string, { memory?: string; agenda?: string } & Record<string, unknown>>
    }>('/api/settings')
    const firstModel = Object.keys(settings?.models ?? {})[0]
    // memory 的 writerModel 必填：无模型时跳过，等模型配好后重试
    if (!firstModel) return false
    // 优先跟随内置助手的当前模型（设置页「默认模型」切换后的值），保持整端一致
    const model = settings?.agents?.['sbot-default']?.model || firstModel

    const channels = settings?.channels
    const web = channels?.web

    // ── 记忆 ──
    let memoryId = findByName(settings?.memoryProfiles, DESKTOP_MEMORY_NAME)
    if (!memoryId) {
      // POST 返回全量 settings（含新 memoryProfiles map），据此拿自动生成的 id
      const after = await api.post<{ memoryProfiles?: Record<string, MemoryProfileEntry> }>(
        '/api/settings/memoryProfiles',
        { name: DESKTOP_MEMORY_NAME, enabled: true, writerModel: model },
      )
      memoryId = findByName(after?.memoryProfiles, DESKTOP_MEMORY_NAME)
    } else {
      const existing = settings?.memoryProfiles?.[memoryId]
      // 复用时仅在 writerModel 缺失（如早期版本创建）时兜底补上，其余字段保留用户改动
      if (existing && !existing.writerModel) {
        await api.put(`/api/settings/memoryProfiles/${encodeURIComponent(memoryId)}`, {
          ...existing, writerModel: model,
        })
      }
    }

    // ── 日程 ──
    let agendaId = findByName(settings?.agendaProfiles, DESKTOP_AGENDA_NAME)
    if (!agendaId) {
      const after = await api.post<{ agendaProfiles?: Record<string, AgendaProfileEntry> }>(
        '/api/settings/agendaProfiles',
        { name: DESKTOP_AGENDA_NAME, enabled: true, syncModel: model },
      )
      agendaId = findByName(after?.agendaProfiles, DESKTOP_AGENDA_NAME)
    }

    if (!memoryId && !agendaId) return false

    // ── Web 渠道默认指向 ──
    if (web && ((memoryId && web.memory !== memoryId) || (agendaId && web.agenda !== agendaId))) {
      // PUT 是整体替换：带回原字段，只改 memory / agenda
      await api.put('/api/settings/channels/web', {
        ...web,
        ...(memoryId ? { memory: memoryId } : {}),
        ...(agendaId ? { agenda: agendaId } : {}),
      })
    }
    return true
  } catch (e) {
    console.error('[defaultProfiles] ensureBuiltinProfiles failed:', e)
    return false
  }
}

/** 把桌面专属记忆 / 日程的模型统一切换为指定模型（整体替换带回原字段，只改 model 字段） */
export async function setBuiltinProfilesModel(model: string): Promise<void> {
  try {
    const settings = await api.get<{
      memoryProfiles?: Record<string, MemoryProfileEntry>
      agendaProfiles?: Record<string, AgendaProfileEntry>
    }>('/api/settings')

    const memoryId = findByName(settings?.memoryProfiles, DESKTOP_MEMORY_NAME)
    const memory = memoryId ? settings?.memoryProfiles?.[memoryId] : undefined
    if (memoryId && memory && memory.writerModel !== model) {
      await api.put(`/api/settings/memoryProfiles/${encodeURIComponent(memoryId)}`, {
        ...memory, writerModel: model,
      })
    }

    const agendaId = findByName(settings?.agendaProfiles, DESKTOP_AGENDA_NAME)
    const agenda = agendaId ? settings?.agendaProfiles?.[agendaId] : undefined
    if (agendaId && agenda && agenda.syncModel !== model) {
      await api.put(`/api/settings/agendaProfiles/${encodeURIComponent(agendaId)}`, {
        ...agenda, syncModel: model,
      })
    }
  } catch (e) {
    console.error('[defaultProfiles] setBuiltinProfilesModel failed:', e)
  }
}
