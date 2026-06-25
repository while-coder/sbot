import path from "path";
import fs from "fs";
import { ChannelPlugin } from "channel.base";
import { WikiPlugin } from "wiki.base";
import { LoggerService } from "../Core/LoggerService";
import { config } from "../Core/Config";
import { wikiPluginRegistry } from "../Wiki/WikiPluginRegistry";
import { channelPluginRegistry } from "./ChannelPluginRegistry";

const logger = LoggerService.getLogger("PluginLoader.ts");

const BUILTIN_PLUGINS = ["channel.lark", "channel.slack", "channel.wecom", "channel.wechat", "channel.onebot", "channel.xiaoai", "channel.dingtalk", "channel.qq"];
/** 内置 wiki 数据源插件（第一方，随 sbot 打包）。第三方 wiki 插件仍走 config.settings.plugins / 本地目录。 */
const BUILTIN_WIKI_PLUGINS = ["wiki.local", "wiki.gdrive"];

/** wiki 数据源插件以 kind:'wiki' 自我标识，与 channel 插件分流。 */
function isWikiPlugin(obj: any): obj is WikiPlugin {
  return (
    obj &&
    obj.kind === "wiki" &&
    typeof obj.type === "string" &&
    typeof obj.init === "function"
  );
}

function isChannelPlugin(obj: any): obj is ChannelPlugin {
  return (
    obj &&
    obj.kind === "channel" &&
    typeof obj.type === "string" &&
    typeof obj.init === "function"
  );
}

/** 从模块导出中提取插件对象（channel 或 wiki），三处位置：模块本身 / default / *Plugin 命名导出。 */
function extractPlugin(mod: any): ChannelPlugin | WikiPlugin | undefined {
  const candidates: any[] = [mod, mod?.default];
  for (const key of Object.keys(mod || {})) {
    if (key.endsWith("Plugin")) candidates.push(mod[key]);
  }
  for (const c of candidates) {
    if (isWikiPlugin(c) || isChannelPlugin(c)) return c;
  }
  return undefined;
}

/**
 * 插件发现/分发器：从内置清单、config.settings.plugins、本地目录三处发现插件模块，
 * 按 kind 分发到对应注册表（channel → channelPluginRegistry，wiki → wikiPluginRegistry）。
 * 本身不持有任何插件 map —— 各类型插件各自由专门的注册表管理，便于后续扩展更多插件类型。
 */
export class PluginLoader {
  async loadAll(): Promise<void> {
    channelPluginRegistry.clear();
    wikiPluginRegistry.clear();

    for (const name of [...BUILTIN_PLUGINS, ...BUILTIN_WIKI_PLUGINS]) {
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

  loadPlugin(moduleOrPath: string): ChannelPlugin | WikiPlugin | undefined {
    return this.tryLoadModule(moduleOrPath, "runtime");
  }

  private tryLoadModule(nameOrPath: string, source: string): ChannelPlugin | WikiPlugin | undefined {
    try {
      const mod = require(nameOrPath);
      const plugin = extractPlugin(mod);
      if (!plugin) {
        logger.warn(`[${source}] Module "${nameOrPath}" does not export a valid Channel/Wiki plugin`);
        return undefined;
      }
      // 按 kind 分发到对应注册表；去重由各注册表的 register 负责。
      if (isWikiPlugin(plugin)) {
        if (wikiPluginRegistry.register(plugin)) {
          logger.info(`[${source}] Loaded wiki plugin "${plugin.type}" from "${nameOrPath}"`);
        }
      } else if (channelPluginRegistry.register(plugin)) {
        logger.info(`[${source}] Loaded channel plugin "${plugin.type}" from "${nameOrPath}"`);
      }
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
