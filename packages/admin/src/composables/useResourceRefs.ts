// 计算某个资源（事项/记忆档案、笔记库、知识库、存储）被频道 / 会话档案 / 智能体引用的情况，
// 供各资源页复刻 AgentsView 的「被引用情况」展示（见 ResourceRefs.vue）。
import { ref } from 'vue'
import { apiFetch } from '@/shared/api'
import { store } from '@/shared/store'

/** 会话档案列表行（GET /api/session-profiles），仅取引用计算需要的字段。 */
interface ProfileLite {
  id: number
  name: string
  agentId: string | null
  saver: string | null
  notes: string | null   // JSON 字符串
  wikis: string | null   // JSON 字符串
  memory: string | null
  agenda: string | null
  sessionCount?: number
}

/** 单个引用方。 */
export interface RefItem { id: string | number; name: string; sessionCount?: number }

/** 某资源的全部引用方，分频道 / 会话档案 / 智能体三类。 */
export interface ResourceRefsValue {
  channels: RefItem[]
  profiles: RefItem[]
  agents: RefItem[]
  total: number
}

/** 三类引用方的匹配器；`agent` 可选（仅存储页用到）。 */
export interface RefMatchers {
  channel: (c: any, id: string) => boolean
  profile: (p: ProfileLite, id: string) => boolean
  agent?: (a: any, id: string) => boolean
}

/** 会话档案的 notes/wikis 是 JSON 字符串，解析为 string[]（同 SessionProfilesView 的 parseList）。 */
export function parseList(raw: string | null | undefined): string[] {
  if (!raw) return []
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : [] } catch { return [] }
}

// 模块级共享：多个页面实例共用同一份会话档案列表。
const profilesList = ref<ProfileLite[]>([])

export function useResourceRefs() {
  async function loadProfiles() {
    try {
      const res = await apiFetch('/api/session-profiles')
      profilesList.value = (res.data || []) as ProfileLite[]
    } catch { /* 引用信息为辅助展示，加载失败时静默降级为空 */ }
  }

  /** 用匹配器生成本页的 refs(id) 计算函数。 */
  function makeResourceRefs(matchers: RefMatchers) {
    return (id: string): ResourceRefsValue => {
      const channels = Object.entries(store.settings.channels || {})
        .filter(([, c]) => matchers.channel(c as any, id))
        .map(([cid, c]) => ({ id: cid, name: (c as any).name || cid }))
      const profiles = profilesList.value
        .filter(p => matchers.profile(p, id))
        .map(p => ({ id: p.id, name: p.name || String(p.id), sessionCount: p.sessionCount ?? 0 }))
      const agents = matchers.agent
        ? Object.entries(store.settings.agents || {})
            .filter(([, a]) => matchers.agent!(a as any, id))
            .map(([aid, a]) => ({ id: aid, name: (a as any).name || aid }))
        : []
      return { channels, profiles, agents, total: channels.length + profiles.length + agents.length }
    }
  }

  return { loadProfiles, makeResourceRefs }
}
