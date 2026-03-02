import { reactive } from 'vue'
import type { Settings, McpEntry, SkillItem } from './types'

export const store = reactive<{
  settings: Settings
  mcpServers: Record<string, McpEntry>
  mcpBuiltins: string[]
  globalSkills: SkillItem[]
  skillBuiltins: SkillItem[]
}>({
  settings: {},
  mcpServers: {},
  mcpBuiltins: [],
  globalSkills: [],
  skillBuiltins: [],
})
