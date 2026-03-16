import { reactive } from 'vue'
import type { Settings, McpEntry, McpBuiltin, SkillItem } from './types'

export const store = reactive<{
  settings: Settings
  mcpServers: Record<string, McpEntry>
  mcpBuiltins: McpBuiltin[]
  allSkills: SkillItem[]
}>({
  settings: {},
  mcpServers: {},
  mcpBuiltins: [],
  allSkills: [],
})
