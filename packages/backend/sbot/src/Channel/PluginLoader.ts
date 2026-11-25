import path from "path";
import fs from "fs";
import { ChannelPlugin } from "channel.base";
import { LoggerService } from "../Core/LoggerService";
import { config } from "../Core/Config";
import { channelPluginRegistry } from "./ChannelPluginRegistry";

const logger = LoggerService.getLogger("PluginLoader.ts");

const BUILTIN_PLUGINS = ["channel.lark", "channel.slack", "channel.wecom", "channel.wechat", "channel.onebot", "channel.xiaoai", "channel.dingtalk", "channel.qq", "channel.yuanbao", "channel.remote-agent"];

function isChannelPlugin(obj: any): obj is ChannelPlugin {
  return (
    obj &&
    obj.kind === "channel" &&
    typeof obj.type === "string" &&
    typeof obj.init === "function"
  );
}

/** 从模块导出中提取渠道插件，三处位置：模块本身 / default / *Plugin 命名导出。 */
function extractPlugin(mod: any): ChannelPlugin | undefined {
  const candidates: any[] = [mod, mod?.default];
  for (const key of Object.keys(mod || {})) {
    if (key.endsWith("Plugin")) candidates.push(mod[key]);
  }
  for (const c of candidates) {
    if (isChannelPlugin(c)) return c;
  }
  return undefined;
}

/**
 * 从内置清单、config.settings.plugins 和本地目录发现渠道插件。
 */
export class PluginLoader {
  async loadAll(): Promise<void> {
    channelPluginRegistry.clear();

    for (const name of BUILTIN_PLUGINS) {
      this.tryLoadModule(name, "built-in");
    }

    const userPlugins = config.settings.plugins ?? [];
    for (const entry of userPlugins) {
      this.tryLoadModule(entry, "config");
    }

    this.scanLocalPlugins();

    logger.info(
      `Loaded ${channelPluginRegistry.size} channel plugin(s): [${channelPluginRegistry.keys().join(", ")}]`,
    );
  }

  loadPlugin(moduleOrPath: string): ChannelPlugin | undefined {
    return this.tryLoadModule(moduleOrPath, "runtime");
  }

  private tryLoadModule(nameOrPath: string, source: string): ChannelPlugin | undefined {
    try {
      const mod = require(nameOrPath);
      const plugin = extractPlugin(mod);
      if (!plugin) {
        logger.warn(`[${source}] Module "${nameOrPath}" does not export a valid channel plugin`);
        return undefined;
      }
      if (channelPluginRegistry.register(plugin)) {
        logger.info(`[${source}] Loaded channel plugin "${plugin.type}" from "${nameOrPath}"`);
      }
      return plugin;
    } catch (e: any) {
      logger.warn(`[${source}] Failed to load plugin "${nameOrPath}": ${e?.message}`);
      return undefined;
    }
  }

  private scanLocalPlugins(): void {
    const pluginsDir = config.getConfigPath("plugins", true);
    if (!fs.existsSync(pluginsDir)) return;

    const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pluginPath = path.join(pluginsDir, entry.name);
      const indexPath = path.join(pluginPath, "index.js");
      if (fs.existsSync(indexPath)) {
        this.tryLoadModule(pluginPath, "local");
      }
    }
  }
}
