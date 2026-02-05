import { PluginManager, globalPluginManager } from "./PluginManager";
import { MemoryPlugin } from "./plugins/MemoryPlugin";
import { config } from "../Config";
import { LoggerService } from "../LoggerService";
import path from "path";

const logger = LoggerService.getLogger("PluginRegistration.ts");

/**
 * 注册所有核心插件
 * @param pluginManager 插件管理器实例（可选，默认使用全局实例）
 */
export async function registerCorePlugins(
  pluginManager: PluginManager = globalPluginManager
): Promise<void> {
  logger.info("开始注册核心插件...");

  const pluginsConfig = config.settings.plugins || {};

  // 注册 MemoryPlugin
  await registerMemoryPlugin(pluginManager, pluginsConfig);

  // 未来可以在此注册更多插件...
  // await registerOtherPlugin(pluginManager, pluginsConfig);

  logger.info(`核心插件注册完成 - 总数: ${pluginManager.getPluginCount()}`);
}

/**
 * 注册 MemoryPlugin
 */
async function registerMemoryPlugin(
  pluginManager: PluginManager,
  pluginsConfig: any
): Promise<void> {
  const memoryPluginConfig = pluginsConfig.MemoryPlugin;

  // 检查是否启用
  if (memoryPluginConfig?.enabled === false) {
    logger.info("MemoryPlugin 已禁用，跳过注册");
    return;
  }

  try {
    // 创建插件实例
    const memoryPlugin = new MemoryPlugin();

    // 准备插件配置
    const pluginConfig = memoryPluginConfig?.config || {};

    // 如果配置中没有 dbPath，使用默认路径
    if (!pluginConfig.dbPath) {
      pluginConfig.dbPath = config.getConfigPath("memory.db");
    } else if (!path.isAbsolute(pluginConfig.dbPath)) {
      // 如果是相对路径，转换为绝对路径
      pluginConfig.dbPath = config.getConfigPath(pluginConfig.dbPath);
    }

    // 如果配置中没有 embeddingConfig，尝试从当前模型配置获取
    if (!pluginConfig.embeddingConfig) {
      const currentModel = config.getCurrentModel();
      if (currentModel) {
        pluginConfig.embeddingConfig = {
          apiKey: currentModel.apiKey,
          baseURL: currentModel.baseURL,
          model: "text-embedding-ada-002" // 使用默认的 embedding 模型
        };
      } else {
        logger.warn("未配置 embedding 模型，MemoryPlugin 可能无法正常工作");
      }
    }

    // 注册插件
    await pluginManager.register(memoryPlugin, {
      enabled: memoryPluginConfig?.enabled !== false,
      priority: memoryPluginConfig?.priority ?? 10,
      config: pluginConfig
    });

    logger.info("MemoryPlugin 注册成功");
  } catch (error: any) {
    logger.error(`注册 MemoryPlugin 失败: ${error.message}`);
    throw error;
  }
}

/**
 * 注销所有插件
 * @param pluginManager 插件管理器实例（可选，默认使用全局实例）
 */
export async function unregisterAllPlugins(
  pluginManager: PluginManager = globalPluginManager
): Promise<void> {
  logger.info("开始注销所有插件...");
  await pluginManager.unloadAll();
  logger.info("所有插件已注销");
}

/**
 * 根据配置重新加载插件
 * @param pluginManager 插件管理器实例（可选，默认使用全局实例）
 */
export async function reloadPlugins(
  pluginManager: PluginManager = globalPluginManager
): Promise<void> {
  logger.info("重新加载插件配置...");

  // 重新加载配置文件
  config.reloadSettings();

  // 注销所有插件
  await unregisterAllPlugins(pluginManager);

  // 重新注册插件
  await registerCorePlugins(pluginManager);

  logger.info("插件重新加载完成");
}
