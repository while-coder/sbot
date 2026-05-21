import { reactive } from 'vue'
import type { Settings, SessionConfig, SkillItem, McpItem } from './types'

export const store = reactive<{
  settings: Settings
  sessions: Record<string, SessionConfig>
  allSkills: SkillItem[]
  allMcps: McpItem[]
}>({
  settings: {},
  sessions: {},
  allSkills: [],
  allMcps: [],
})

export function applyMcpList(list: McpItem[]) {
  store.allMcps = list
}
