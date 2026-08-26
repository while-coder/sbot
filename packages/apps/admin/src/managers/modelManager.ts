import { computed } from 'vue'
import { store } from '@/shared/store'

/** 下拉选项形态（id + 显示名）。 */
export interface ModelOption { id: string; label: string }

/**
 * 模型配置管理：数据来自 settings.models（由 settingsManager 统一刷新），
 * 这里只提供跨页面共用的下拉选项与显示名解析。
 */
class ModelManager {
  readonly list = computed(() => store.settings.models || {})

  /** 模型下拉选项（id + 显示名）。 */
  readonly options = computed<ModelOption[]>(() =>
    Object.entries(this.list.value).map(([id, m]) => ({ id, label: (m as any).name || id })),
  )

  /** 模型显示名（找不到时回退 id；空值返回空串）。 */
  nameOf(id: string | null | undefined): string {
    if (!id) return ''
    return (this.list.value as any)[id]?.name || id
  }
}

export const modelManager = new ModelManager()
