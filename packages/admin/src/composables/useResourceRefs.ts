// 计算某个资源（事项/记忆档案、笔记库、知识库、存储）被频道 / 会话档案 / 智能体引用的情况，
// 供各资源页复刻 AgentsView 的「被引用情况」展示（见 ResourceRefs.vue）。
import { ref } from 'vue'
import { apiFetch } from '@/shared/api'
import { store } from '@/shared/store'

/** 会话档案列表行（GET /api/session-profiles，仅 visible profile），仅取引用计算需要的字段。 */
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

/**
 * 会话列表行（GET /api/channel-sessions），仅取引用计算需要的字段。
 * 字段值已是 profile 自身覆盖值（null = 继承频道默认）；notes/wikis 已解析为 string[]。
 * 用于补全「按会话直接覆盖、存在各自 auto profile 上」的引用 —— 这些 profile 不在
 * /api/session-profiles（只返回 visible profile）里，否则会被漏扫。
 */
interface SessionLite {
  id: number
  profileId: number
  channelId: string
  sessionName: string
  autoSessionName: string
  agentId: string | null
  saver: string | null
  notes: string[] | null
  wikis: string[] | null
  memory: string | null
  agenda: string | null
}

/** 单个引用方。 */
export interface RefItem { id: string | number; name: string; sessionCount?: number }

/** 某资源的全部引用方，分频道 / 会话档案 / 会话 / 智能体四类。 */
export interface ResourceRefsValue {
  channels: RefItem[]
  profiles: RefItem[]
  sessions: RefItem[]
  agents: RefItem[]
  total: number
}

/**
 * 各类引用方的匹配器。
 * - `agent` 可选（仅存储页用到）。
 * - `session` 可选：匹配「会话私有覆盖」（auto profile），与 visible profile 互斥统计，不重复计数。
 */
export interface RefMatchers {
  channel: (c: any, id: string) => boolean
  profile: (p: ProfileLite, id: string) => boolean
  session?: (s: SessionLite, id: string) => boolean
  agent?: (a: any, id: string) => boolean
}

/** 会话档案的 notes/wikis 是 JSON 字符串，解析为 string[]（同 SessionProfilesView 的 parseList）。 */
export function parseList(raw: string | null | undefined): string[] {
  if (!raw) return []
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : [] } catch { return [] }
}

// 模块级共享：多个页面实例共用同一份会话档案 / 会话列表。
const profilesList = ref<ProfileLite[]>([])
const sessionsList = ref<SessionLite[]>([])

export function useResourceRefs() {
  async function loadProfiles() {
    // visible profile 与会话各取所需字段：会话用于补全 auto profile 上的私有覆盖引用。
    const [profilesRes, sessionsRes] = await Promise.allSettled([
      apiFetch('/api/session-profiles'),
      apiFetch('/api/channel-sessions'),
    ])
    // 引用信息为辅助展示，任一接口失败时静默降级为空。
    profilesList.value = profilesRes.status === 'fulfilled' ? (profilesRes.value.data || []) as ProfileLite[] : []
    sessionsList.value = sessionsRes.status === 'fulfilled' ? (sessionsRes.value.data || []) as SessionLite[] : []
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
      // 会话私有覆盖：仅统计走各自 auto profile 的会话（profileId 不在 visible profile 集合里），
      // 避免与上面共享 visible profile 的会话重复计数。
      const visibleProfileIds = new Set(profilesList.value.map(p => p.id))
      const sessions = matchers.session
        ? sessionsList.value
            .filter(s => !visibleProfileIds.has(s.profileId) && matchers.session!(s, id))
            .map(s => ({ id: s.id, name: s.sessionName || s.autoSessionName || String(s.id) }))
        : []
      const agents = matchers.agent
        ? Object.entries(store.settings.agents || {})
            .filter(([, a]) => matchers.agent!(a as any, id))
            .map(([aid, a]) => ({ id: aid, name: (a as any).name || aid }))
        : []
      return {
        channels, profiles, sessions, agents,
        total: channels.length + profiles.length + sessions.length + agents.length,
      }
    }
  }

  return { loadProfiles, makeResourceRefs }
}
