import { ref, computed } from 'vue'

/**
 * 全局资源 Manager 的通用基类：懒加载 + 缓存 + inflight 合并 + 强制刷新。
 * 各 Manager（channel / profile / skills / mcp …）继承它持有模块级单例数据，
 * 界面通过单例方法访问，不再各写一份 fetch。
 */
export class ResourceManager<T> {
  /** 当前缓存数据；未加载时为 undefined。 */
  readonly data = ref<T>()
  readonly loaded = ref(false)
  private inflight: Promise<T> | null = null

  constructor(private fetcher: () => Promise<T>) {}

  /** 加载数据（带缓存）。force=true 时强制重新请求；并发调用共享同一次请求。 */
  async ensure(force = false): Promise<T> {
    if (this.loaded.value && !force) return this.data.value!
    if (!this.inflight) {
      this.inflight = this.fetcher()
        .then(r => { this.data.value = r; this.loaded.value = true; this.inflight = null; return r })
        .catch(e => { this.inflight = null; throw e })
    }
    return this.inflight
  }
}

/** 列表型 Manager 基类：额外提供空数组兜底的 list 视图。 */
export class ListResourceManager<T> extends ResourceManager<T[]> {
  /** 全部数据（未加载时为空数组）。 */
  readonly list = computed(() => this.data.value ?? [])
}
