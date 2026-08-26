import { computed } from 'vue'
import { store } from '@/shared/store'

/** 下拉选项形态（id + 显示名 + provider/model 明细）。 */
export interface EmbeddingOption { id: string; label: string; detail: string }

/**
 * 向量模型配置管理：数据来自 settings.embeddings（由 settingsManager 统一刷新），
 * 这里只提供跨页面共用的下拉选项与显示名解析。
 */
class EmbeddingManager {
  readonly list = computed(() => store.settings.embeddings || {})

  /** 向量模型下拉选项（id + 显示名 + provider/model 明细）。 */
  readonly options = computed<EmbeddingOption[]>(() =>
    Object.entries(this.list.value).map(([id, e]) => ({
      id,
      label: (e as any).name || id,
      detail: `${(e as any).provider} / ${(e as any).model}`,
    })),
  )

  /** 向量模型显示名（找不到时回退 id；空值返回空串）。 */
  nameOf(id: string | null | undefined): string {
    if (!id) return ''
    return (this.list.value as any)[id]?.name || id
  }
}

export const embeddingManager = new EmbeddingManager()
