import { apiFetch } from '@/shared/api'
import { ListResourceManager } from '@/shared/resourceManager'
import type { McpItem } from '@/shared/types'

/** 全局 MCP 数据管理（懒加载缓存）。 */
class McpManager extends ListResourceManager<McpItem> {
  constructor() {
    super(async () => (await apiFetch('/api/mcp')).data || [])
  }

  /** 按 id 查找 MCP 配置。 */
  get(id: string): McpItem | undefined {
    return this.list.value.find(m => m.id === id)
  }

  /** MCP 显示名（找不到时回退 id）。 */
  nameOf(id: string): string {
    return this.get(id)?.name || id
  }
}

export const mcpManager = new McpManager()
