import { computed, reactive } from 'vue'
import type { ComputedRef } from 'vue'
import { apiFetch } from '@/shared/api'

/** /api/prompts/files 返回的文件行。 */
export interface PromptFileItem {
  path: string
  isUserOnly?: boolean
  [key: string]: unknown
}

/** prompts 文件列表管理：按 prefix 懒加载缓存（heartbeat / memory / agenda/sync …）。 */
class PromptFileManager {
  private readonly filesMap = reactive<Record<string, PromptFileItem[]>>({})
  private inflight = new Map<string, Promise<PromptFileItem[]>>()

  /** prefix 下的文件列表（响应式视图，未加载时为空数组）。 */
  list(prefix: string): ComputedRef<PromptFileItem[]> {
    return computed(() => this.filesMap[prefix] || [])
  }

  /** 加载某 prefix 的文件列表（带缓存）。force=true 时强制刷新。 */
  async ensure(prefix: string, force = false): Promise<PromptFileItem[]> {
    if (!force && prefix in this.filesMap) return this.filesMap[prefix]
    if (!this.inflight.has(prefix)) {
      const p = apiFetch(`/api/prompts/files?prefix=${encodeURIComponent(prefix)}`)
        .then(res => { this.filesMap[prefix] = res.data || []; return this.filesMap[prefix] })
        .finally(() => { this.inflight.delete(prefix) })
      this.inflight.set(prefix, p)
    }
    return this.inflight.get(prefix)!
  }
}

export const promptFileManager = new PromptFileManager()
