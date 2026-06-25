import { WikiPlugin } from "wiki.base";
import { LoggerService } from "../Core/LoggerService";

const logger = LoggerService.getLogger("WikiPluginRegistry");

/**
 * Wiki 数据源插件注册表（与 ChannelPluginRegistry 对称）。
 * 内置（wiki.local / wiki.gdrive）与第三方插件统一由 PluginLoader 发现后 register。
 */
export class WikiPluginRegistry {
  private plugins = new Map<string, WikiPlugin>();

  /** 重新发现前清空（reload 时全量重建）。 */
  clear(): void {
    this.plugins.clear();
  }

  register(plugin: WikiPlugin): boolean {
    if (this.plugins.has(plugin.type)) {
      logger.warn(`Wiki plugin type "${plugin.type}" already registered, skipping`);
      return false;
    }
    this.plugins.set(plugin.type, plugin);
    return true;
  }

  get(type: string): WikiPlugin | undefined {
    return this.plugins.get(type);
  }

  /** 供 admin /api/wiki-plugins 暴露给前端渲染数据源下拉与配置表单。 */
  list(): Array<{ type: string; label: string; configSchema: Record<string, any>; readOnly: boolean }> {
    return [...this.plugins.values()].map(p => ({
      type: p.type,
      label: p.label,
      configSchema: p.configSchema,
      readOnly: !!p.readOnly,
    }));
  }
}

export const wikiPluginRegistry = new WikiPluginRegistry();
