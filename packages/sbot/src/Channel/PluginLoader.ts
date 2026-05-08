import path from "path";
import fs from "fs";
import { ChannelPlugin } from "channel.base";
import { LoggerService } from "../Core/LoggerService";
import { config } from "../Core/Config";

const logger = LoggerService.getLogger("PluginLoader.ts");

const BUILTIN_PLUGINS = ["channel.lark", "channel.slack", "channel.wecom", "channel.wechat", "channel.onebot", "channel.xiaoai"];

function isChannelPlugin(obj: any): obj is ChannelPlugin {
  return (
    obj &&
    typeof obj.type === "string" &&
    typeof obj.init === "function"
  );
}

function extractPlugin(mod: any): ChannelPlugin | undefined {
  if (isChannelPlugin(mod)) return mod;
  if (isChannelPlugin(mod?.default)) return mod.default;
  for (const key of Object.keys(mod || {})) {
    if (key.endsWith("Plugin") && isChannelPlugin(mod[key])) return mod[key];
  }
  return undefined;
}

export class PluginLoader {
  private plugins = new Map<string, ChannelPlugin>();

  async loadAll(): Promise<Map<string, ChannelPlugin>> {
    this.plugins.clear();

    for (const name of BUILTIN_PLUGINS) {
      this.tryLoadModule(name, "built-in");
    }

    const userPlugins = config.settings.plugins ?? [];
    for (const entry of userPlugins) {
      this.tryLoadModule(entry, "config");
    }

    this.scanLocalPlugins();

    logger.info(`Loaded ${this.plugins.size} channel plugin(s): [${[...this.plugins.keys()].join(", ")}]`);
    return this.plugins;
  }

  loadPlugin(moduleOrPath: string): ChannelPlugin | undefined {
    return this.tryLoadModule(moduleOrPath, "runtime");
  }

  private tryLoadModule(nameOrPath: string, source: string): ChannelPlugin | undefined {
    try {
      const mod = require(nameOrPath);
      const plugin = extractPlugin(mod);
      if (!plugin) {
        logger.warn(`[${source}] Module "${nameOrPath}" does not export a valid ChannelPlugin`);
        return undefined;
      }
      if (this.plugins.has(plugin.type)) {
        logger.warn(`[${source}] Plugin type "${plugin.type}" already registered, skipping "${nameOrPath}"`);
        return undefined;
      }
      this.plugins.set(plugin.type, plugin);
      logger.info(`[${source}] Loaded channel plugin "${plugin.type}" from "${nameOrPath}"`);
      return plugin;
    } catch (e: any) {
      if (source !== "built-in" || e?.code !== "MODULE_NOT_FOUND") {
        logger.warn(`[${source}] Failed to load plugin "${nameOrPath}": ${e?.message}`);
      }
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
