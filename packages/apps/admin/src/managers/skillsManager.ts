import { apiFetch } from '@/shared/api'
import { ListResourceManager } from '@/shared/resourceManager'
import type { SkillItem } from '@/shared/types'

/** 全局技能数据管理（懒加载缓存）。 */
class SkillsManager extends ListResourceManager<SkillItem> {
  constructor() {
    super(async () => (await apiFetch('/api/skills')).data || [])
  }
}

export const skillsManager = new SkillsManager()
