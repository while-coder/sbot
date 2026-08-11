import { ChannelPlugin } from "channel.base";
import { LoggerService } from "../Core/LoggerService";

const logger = LoggerService.getLogger("ChannelPluginRegistry");

/**
 * Channel 插件注册表（与 WikiPluginRegistry 对称）。
 * 由 PluginLoader 发现插件后 register；ChannelManager 据此查找/列举。
 */
export class ChannelPluginRegistry {
  private plugins = new Map<string, ChannelPlugin>();

  /** 重新发现前清空（reload 时全量重建）。 */
  clear(): void {
    this.plugins.clear();
  }

  register(plugin: ChannelPlugin): boolean {
    if (this.plugins.has(plugin.type)) {
      logger.warn(`Channel plugin type "${plugin.type}" already registered, skipping`);
      return false;
    }
    this.plugins.set(plugin.type, plugin);
    return true;
  }

  get(type: string): ChannelPlugin | undefined {
    return this.plugins.get(type);
  }

  list(): ChannelPlugin[] {
    return [...this.plugins.values()];
  }

  get size(): number {
    return this.plugins.size;
  }

  keys(): string[] {
    return [...this.plugins.keys()];
  }
}

export const channelPluginRegistry = new ChannelPluginRegistry();
