/**
 * Container 自注入示例
 *
 * 展示如何在构造函数中注入 Container 本身，实现延迟解析和动态服务获取
 */

import { singleton, inject, Container, globalContainer } from "../src/Core";

// ============================================================
// 场景 1: 动态服务工厂
// ============================================================
// 有时需要根据运行时条件选择不同的服务

@singleton()
class ServiceFactory {
  constructor(
    @inject(Container) private container: Container
  ) {}

  /**
   * 根据类型动态创建服务
   */
  async createService<T>(serviceType: string): Promise<T | null> {
    switch (serviceType) {
      case "database":
        return await this.container.resolve<T>(DatabaseService as any);
      case "cache":
        return await this.container.resolve<T>(CacheService as any);
      default:
        return null;
    }
  }

  /**
   * 延迟解析 - 避免循环依赖
   */
  async lazyResolve<T>(token: any): Promise<T> {
    return await this.container.resolve<T>(token);
  }
}

// ============================================================
// 场景 2: 插件系统
// ============================================================
// 插件需要访问容器来注册和解析其他服务

interface Plugin {
  name: string;
  init(): Promise<void>;
}

@singleton()
class PluginManager {
  private plugins: Plugin[] = [];

  constructor(
    @inject(Container) private container: Container
  ) {}

  /**
   * 注册插件
   */
  registerPlugin(plugin: Plugin): void {
    this.plugins.push(plugin);
  }

  /**
   * 初始化所有插件
   */
  async initializePlugins(): Promise<void> {
    for (const plugin of this.plugins) {
      await plugin.init();
    }
  }

  /**
   * 插件可以通过 container 注册自己的服务
   */
  getContainer(): Container {
    return this.container;
  }
}

// 插件示例
class LoggingPlugin implements Plugin {
  name = "LoggingPlugin";

  constructor(private container: Container) {}

  async init(): Promise<void> {
    // 插件可以向容器注册自己的服务
    this.container.registerInstance("LOGGING_ENABLED", true);
    console.log("✅ LoggingPlugin 已初始化");
  }
}

// ============================================================
// 场景 3: 作用域服务
// ============================================================
// 需要为每个请求创建独立的服务作用域

@singleton()
class RequestScopeManager {
  constructor(
    @inject(Container) private parentContainer: Container
  ) {}

  /**
   * 为每个请求创建子容器
   */
  createRequestScope(): Container {
    const requestContainer = new Container();

    // 子容器可以访问父容器的单例服务
    // 但有自己独立的瞬时服务实例

    requestContainer.registerInstance("REQUEST_ID", Math.random().toString(36));

    return requestContainer;
  }
}

// ============================================================
// 示例服务
// ============================================================

@singleton()
class DatabaseService {
  readonly name = "DatabaseService";

  connect(): string {
    return "数据库已连接";
  }
}

@singleton()
class CacheService {
  readonly name = "CacheService";

  get(key: string): string {
    return `缓存值: ${key}`;
  }
}

@singleton()
class UserService {
  constructor(
    @inject(Container) private container: Container
  ) {}

  /**
   * 延迟解析 - 只在需要时才解析依赖
   */
  async getDatabase(): Promise<DatabaseService> {
    return await this.container.resolve(DatabaseService);
  }

  /**
   * 动态服务切换
   */
  async useService(serviceType: "database" | "cache"): Promise<string> {
    if (serviceType === "database") {
      const db = await this.container.resolve(DatabaseService);
      return db.connect();
    } else {
      const cache = await this.container.resolve(CacheService);
      return cache.get("test");
    }
  }
}

// ============================================================
// 主函数
// ============================================================

async function main() {
  console.log("╔═══════════════════════════════════════════╗");
  console.log("║   Container 自注入 - 高级特性演示        ║");
  console.log("╚═══════════════════════════════════════════╝\n");

  // ----------------------------------------------------------
  // 1. ServiceFactory - 动态服务创建
  // ----------------------------------------------------------
  console.log("📦 [场景 1] 动态服务工厂\n");

  const factory = await globalContainer.resolve(ServiceFactory);

  const dbService = await factory.createService<DatabaseService>("database");
  console.log(`  创建服务: ${dbService?.name}`);
  console.log(`  调用方法: ${dbService?.connect()}`);

  const cacheService = await factory.createService<CacheService>("cache");
  console.log(`  创建服务: ${cacheService?.name}`);
  console.log(`  调用方法: ${cacheService?.get("hello")}\n`);

  // ----------------------------------------------------------
  // 2. PluginManager - 插件系统
  // ----------------------------------------------------------
  console.log("🔌 [场景 2] 插件系统\n");

  const pluginManager = await globalContainer.resolve(PluginManager);

  // 插件通过容器注册
  const loggingPlugin = new LoggingPlugin(pluginManager.getContainer());
  pluginManager.registerPlugin(loggingPlugin);

  await pluginManager.initializePlugins();

  // 验证插件注册的服务
  const loggingEnabled = await globalContainer.resolve<boolean>("LOGGING_ENABLED");
  console.log(`  日志功能已启用: ${loggingEnabled}\n`);

  // ----------------------------------------------------------
  // 3. RequestScopeManager - 请求作用域
  // ----------------------------------------------------------
  console.log("🔄 [场景 3] 请求作用域\n");

  const scopeManager = await globalContainer.resolve(RequestScopeManager);

  const request1 = scopeManager.createRequestScope();
  const request2 = scopeManager.createRequestScope();

  const reqId1 = await request1.resolve<string>("REQUEST_ID");
  const reqId2 = await request2.resolve<string>("REQUEST_ID");

  console.log(`  请求 1 ID: ${reqId1}`);
  console.log(`  请求 2 ID: ${reqId2}`);
  console.log(`  不同作用域: ${reqId1 !== reqId2}\n`);

  // ----------------------------------------------------------
  // 4. UserService - 延迟解析
  // ----------------------------------------------------------
  console.log("⏱️  [场景 4] 延迟解析\n");

  const userService = await globalContainer.resolve(UserService);

  // 只在调用时才解析 DatabaseService
  const db = await userService.getDatabase();
  console.log(`  延迟获取: ${db.name}`);

  // 动态切换服务
  const dbResult = await userService.useService("database");
  console.log(`  使用 database: ${dbResult}`);

  const cacheResult = await userService.useService("cache");
  console.log(`  使用 cache: ${cacheResult}\n`);

  // ----------------------------------------------------------
  // 5. 容器调试
  // ----------------------------------------------------------
  console.log("🐛 [容器状态]");
  globalContainer.debug();

  console.log("✨ 演示完成！");
}

// 运行示例
// main().catch(console.error);

export { ServiceFactory, PluginManager, RequestScopeManager, UserService };
