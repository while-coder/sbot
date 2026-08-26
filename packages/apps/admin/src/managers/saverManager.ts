import { reactive } from 'vue'
import { apiFetch } from '@/shared/api'

/** Saver 数据管理：各 saver 的 thread 列表懒加载缓存 + 历史清理（SaversView / ChannelsView 共用）。 */
class SaverManager {
  /** saverId → thread 列表（加载完成后填充；reset 后重新加载）。 */
  readonly threadsMap = reactive<Record<string, string[]>>({})
  readonly loadingMap = reactive<Record<string, boolean>>({})
  private inflight = new Map<string, Promise<string[]>>()

  /** 加载某个 saver 的 thread 列表（带缓存）。force=true 时强制刷新。 */
  async loadThreads(saverId: string, force = false): Promise<string[]> {
    if (!force && saverId in this.threadsMap) return this.threadsMap[saverId]
    if (!this.inflight.has(saverId)) {
      this.loadingMap[saverId] = true
      const p = apiFetch(`/api/savers/${encodeURIComponent(saverId)}/threads`)
        .then(res => { this.threadsMap[saverId] = res.data || []; return this.threadsMap[saverId] })
        .finally(() => { this.inflight.delete(saverId); this.loadingMap[saverId] = false })
      this.inflight.set(saverId, p)
    }
    return this.inflight.get(saverId)!
  }

  /** 清空某个 thread 的历史；成功后同步移除 thread 缓存。 */
  async clearHistory(saverId: string, thread: string): Promise<void> {
    await apiFetch(
      `/api/savers/${encodeURIComponent(saverId)}/threads/${encodeURIComponent(thread)}/history`,
      'DELETE',
    )
    const list = this.threadsMap[saverId]
    if (list) this.threadsMap[saverId] = list.filter(t => t !== thread)
  }

  /** 丢弃某个 saver 的 thread 缓存（配置刷新后重新加载）。 */
  reset(saverId: string) {
    delete this.threadsMap[saverId]
  }
}

export const saverManager = new SaverManager()
