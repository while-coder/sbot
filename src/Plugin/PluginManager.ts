import { IPlugin, PluginMetadata, PluginConfig, PluginContext, PluginHookType, HookResult } from "./IPlugin";
import { EventBus, globalEventBus } from "./EventBus";
import { LoggerService } from "../LoggerService";

const logger = LoggerService.getLogger("PluginManager.ts");

/**
 * 插件注册信息
 */
interface PluginRegistration {
  plugin: IPlugin;
  config: PluginConfig;
  context: PluginContext;
}

/**
 * 插件管理器
 * 负责插件的加载、卸载、生命周期管理和钩子执行
 */
export class PluginManager {
  /**
   * 已注册的插件
   */
  private plugins: Map<string, PluginRegistration> = new Map();

  /**
   * 事件总线
   */
  private eventBus: EventBus;

  /**
   * 插件加载顺序（按优先级排序）
   */
  private loadOrder: string[] = [];

  constructor(eventBus: EventBus = globalEventBus) {
    this.eventBus = eventBus;
  }

  /**
   * 注册插件
   * @param plugin 插件实例
   * @param config 插件配置
   */
  async register(plugin: IPlugin, config: PluginConfig = {}): Promise<void> {
    const name = plugin.metadata.name;

    if (this.plugins.has(name)) {
      logger.warn(`插件 ${name} 已注册，将被覆盖`);
      await this.unregister(name);
    }

    // 检查依赖
    if (plugin.metadata.dependencies) {
      for (const dep of plugin.metadata.dependencies) {
        if (!this.plugins.has(dep)) {
          throw new Error(`插件 ${name} 依赖的插件 ${dep} 未注册`);
        }
      }
    }

    // 创建插件上下文
    const context: PluginContext = {
      eventBus: this.eventBus,
      config: config.config || {},
      logger: LoggerService.getLogger(`Plugin:${name}`),
      getPlugin: (pluginName: string) => this.getPlugin(pluginName)
    };

    // 注册插件
    this.plugins.set(name, { plugin, config, context });

    // 更新加载顺序
    this.updateLoadOrder();

    logger.info(`注册插件: ${name} v${plugin.metadata.version}`);

    // 如果插件已启用，立即加载
    if (config.enabled !== false) {
      await this.load(name);
    }

    // 发送事件
    this.eventBus.emit("plugin:registered", { name, metadata: plugin.metadata });
  }

  /**
   * 注销插件
   * @param name 插件名称
   */
  async unregister(name: string): Promise<void> {
    const registration = this.plugins.get(name);
    if (!registration) {
      logger.warn(`插件 ${name} 未注册`);
      return;
    }

    // 卸载插件
    await this.unload(name);

    // 移除注册
    this.plugins.delete(name);
    this.updateLoadOrder();

    logger.info(`注销插件: ${name}`);

    // 发送事件
    this.eventBus.emit("plugin:unregistered", { name });
  }

  /**
   * 加载插件
   * @param name 插件名称
   */
  async load(name: string): Promise<void> {
    const registration = this.plugins.get(name);
    if (!registration) {
      throw new Error(`插件 ${name} 未注册`);
    }

    const { plugin, context } = registration;

    if (plugin.isLoaded) {
      logger.warn(`插件 ${name} 已加载`);
      return;
    }

    try {
      // 调用 onLoad 钩子
      if (plugin.onLoad) {
        await plugin.onLoad(context);
      }

      plugin.isLoaded = true;
      logger.info(`加载插件: ${name}`);

      // 发送事件
      this.eventBus.emit("plugin:loaded", { name, metadata: plugin.metadata });
    } catch (error: any) {
      logger.error(`加载插件 ${name} 失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 卸载插件
   * @param name 插件名称
   */
  async unload(name: string): Promise<void> {
    const registration = this.plugins.get(name);
    if (!registration) {
      logger.warn(`插件 ${name} 未注册`);
      return;
    }

    const { plugin } = registration;

    if (!plugin.isLoaded) {
      logger.warn(`插件 ${name} 未加载`);
      return;
    }

    try {
      // 调用 onUnload 钩子
      if (plugin.onUnload) {
        await plugin.onUnload();
      }

      plugin.isLoaded = false;
      logger.info(`卸载插件: ${name}`);

      // 发送事件
      this.eventBus.emit("plugin:unloaded", { name });
    } catch (error: any) {
      logger.error(`卸载插件 ${name} 失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 重新加载插件
   * @param name 插件名称
   */
  async reload(name: string): Promise<void> {
    await this.unload(name);
    await this.load(name);
  }

  /**
   * 启用插件
   * @param name 插件名称
   */
  async enable(name: string): Promise<void> {
    const registration = this.plugins.get(name);
    if (!registration) {
      throw new Error(`插件 ${name} 未注册`);
    }

    registration.config.enabled = true;
    await this.load(name);
  }

  /**
   * 禁用插件
   * @param name 插件名称
   */
  async disable(name: string): Promise<void> {
    const registration = this.plugins.get(name);
    if (!registration) {
      throw new Error(`插件 ${name} 未注册`);
    }

    registration.config.enabled = false;
    await this.unload(name);
  }

  /**
   * 执行插件钩子
   * @param hookName 钩子名称
   * @param data 钩子数据
   * @param context 上下文
   * @returns 处理后的数据
   */
  async executeHook<T = any>(
    hookName: PluginHookType,
    data: T,
    context?: any
  ): Promise<T> {
    let result = data;

    for (const pluginName of this.loadOrder) {
      const registration = this.plugins.get(pluginName);
      if (!registration || !registration.plugin.isLoaded) {
        continue;
      }

      const { plugin } = registration;
      const hook = plugin[hookName] as any;

      if (hook) {
        try {
          // 根据不同的钩子类型传递参数
          if (hookName === "onBeforeQuery") {
            result = await hook.call(plugin, result, context);
          } else if (hookName === "onAfterResponse") {
            result = await hook.call(plugin, result, data, context);
          } else if (hookName === "onMessage") {
            result = await hook.call(plugin, result, context);
          } else {
            await hook.call(plugin, data, context);
          }
        } catch (error: any) {
          logger.error(`插件 ${pluginName} 执行钩子 ${hookName} 失败: ${error.message}`);

          // 触发错误处理钩子
          if (plugin.onError) {
            try {
              await plugin.onError(error, context);
            } catch (err: any) {
              logger.error(`插件 ${pluginName} 错误处理失败: ${err.message}`);
            }
          }
        }
      }
    }

    return result;
  }

  /**
   * 获取插件
   * @param name 插件名称
   */
  getPlugin(name: string): IPlugin | undefined {
    return this.plugins.get(name)?.plugin;
  }

  /**
   * 获取所有已加载的插件
   */
  getLoadedPlugins(): IPlugin[] {
    return Array.from(this.plugins.values())
      .filter(reg => reg.plugin.isLoaded)
      .map(reg => reg.plugin);
  }

  /**
   * 获取所有插件元数据
   */
  getPluginMetadata(): PluginMetadata[] {
    return Array.from(this.plugins.values()).map(reg => reg.plugin.metadata);
  }

  /**
   * 检查插件是否已注册
   */
  hasPlugin(name: string): boolean {
    return this.plugins.has(name);
  }

  /**
   * 检查插件是否已加载
   */
  isPluginLoaded(name: string): boolean {
    return this.plugins.get(name)?.plugin.isLoaded ?? false;
  }

  /**
   * 获取插件数量
   */
  getPluginCount(): number {
    return this.plugins.size;
  }

  /**
   * 更新插件加载顺序（按优先级排序）
   */
  private updateLoadOrder(): void {
    this.loadOrder = Array.from(this.plugins.entries())
      .sort((a, b) => {
        const priorityA = a[1].config.priority ?? 100;
        const priorityB = b[1].config.priority ?? 100;
        return priorityA - priorityB;
      })
      .map(([name]) => name);
  }

  /**
   * 卸载所有插件
   */
  async unloadAll(): Promise<void> {
    logger.info("卸载所有插件...");

    for (const name of this.loadOrder.reverse()) {
      try {
        await this.unload(name);
      } catch (error: any) {
        logger.error(`卸载插件 ${name} 失败: ${error.message}`);
      }
    }

    logger.info("所有插件已卸载");
  }

  /**
   * 调试信息
   */
  debug(): void {
    console.log("\n=== PluginManager 调试信息 ===");
    console.log(`总插件数: ${this.plugins.size}`);
    console.log(`已加载插件数: ${this.getLoadedPlugins().length}`);
    console.log("\n插件列表（按优先级）:");

    for (const name of this.loadOrder) {
      const registration = this.plugins.get(name)!;
      const { plugin, config } = registration;
      const status = plugin.isLoaded ? "✓" : "✗";
      const enabled = config.enabled !== false ? "启用" : "禁用";
      const priority = config.priority ?? 100;

      console.log(
        `  ${status} ${name} v${plugin.metadata.version} (${enabled}, 优先级: ${priority})`
      );

      if (plugin.metadata.dependencies) {
        console.log(`    依赖: ${plugin.metadata.dependencies.join(", ")}`);
      }
    }

    console.log("\n==========================\n");
  }
}

/**
 * 全局插件管理器实例
 */
export const globalPluginManager = new PluginManager();
