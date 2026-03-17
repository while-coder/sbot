import { reactive } from 'vue'
import type { Settings, SkillItem, McpItem } from './types'

export const store = reactive<{
  settings: Settings
  allSkills: SkillItem[]
  allMcps: McpItem[]
}>({
  settings: {},
  allSkills: [],
  allMcps: [],
})

export function applyMcpList(list: McpItem[]) {
  store.allMcps = list
}
