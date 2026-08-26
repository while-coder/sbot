import { apiFetch } from '@/shared/api'
import { ListResourceManager } from '@/shared/resourceManager'

/** /api/session-profiles 返回的会话档案行（仅 visible profile，字段按需宽松保留）。 */
export interface SessionProfileItem {
  id: number
  name: string
  agentId?: string | null
  saver?: string | null
  intentModel?: string | null
  notes?: string | null   // JSON 字符串
  wikis?: string | null   // JSON 字符串
  memory?: string | null
  agenda?: string | null
  sessionCount?: number
  [key: string]: unknown
}

/** 会话档案数据管理：可见 profile 列表（懒加载缓存）。 */
class ProfileManager extends ListResourceManager<SessionProfileItem> {
  constructor() {
    super(async () => (await apiFetch('/api/session-profiles')).data || [])
  }
}

export const profileManager = new ProfileManager()
