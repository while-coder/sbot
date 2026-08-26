import { reactive } from 'vue'
import type { Settings, SessionConfig } from './types'

export const store = reactive<{
  settings: Settings
  sessions: Record<string, SessionConfig>
}>({
  settings: {},
  sessions: {},
})
