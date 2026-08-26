import { apiFetch } from '@/shared/api'
import { store } from '@/shared/store'
import type { Settings } from '@/shared/types'

/** 全局 settings 数据管理：统一「重新拉取」与「保存后合并」两个入口。 */
class SettingsManager {
  private inflight: Promise<void> | null = null

  /** 重新拉取全量 settings 并合并进全局 store（并发调用共享同一次请求）。 */
  async refresh(): Promise<void> {
    if (!this.inflight) {
      this.inflight = apiFetch('/api/settings')
        .then(res => { this.apply(res.data); this.inflight = null })
        .catch(e => { this.inflight = null; throw e })
    }
    return this.inflight
  }

  /** 用保存接口返回的 settings 增量合并进全局 store（不发请求）。 */
  apply(data: Settings | undefined) {
    if (data) Object.assign(store.settings, data)
  }
}

export const settingsManager = new SettingsManager()
