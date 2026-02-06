/**
 * ServiceContainer 快速上手指南
 * 最简单的完整示例，展示核心概念
 *
 * 运行方式:
 *   npx ts-node examples/ServiceContainerQuickStart.ts
 */

import { ServiceContainer, IService } from "../src/Core";

// ============================================
// 步骤1: 定义服务
// ============================================

/**
 * 服务A: 日志服务（不依赖其他服务）
 */
class LoggerService implements IService {
  readonly serviceName = "LoggerService";
  isInitialized = false;

  async initialize(): Promise<void> {
    console.log("✅ LoggerService 已初始化");
    this.isInitialized = true;
  }

  log(message: string): void {
    console.log(`[LOG] ${message}`);
  }
}

/**
 * 服务B: 数据库服务（依赖 LoggerService）
 */
class DatabaseService implements IService {
  readonly serviceName = "DatabaseService";
  isInitialized = false;

  private logger?: LoggerService;

  async initialize(): Promise<void> {
    this.logger?.log("DatabaseService 正在初始化...");
    console.log("✅ DatabaseService 已初始化");
    this.isInitialized = true;
  }

  // 【关键方法1】手动注入依赖
  setLogger(logger: LoggerService): void {
    this.logger = logger;
  }

  query(sql: string): any[] {
    this.logger?.log(`执行 SQL: ${sql}`);
    return [{ id: 1, name: "测试数据" }];
  }
}

/**
 * 服务C: 用户服务（依赖 LoggerService 和 DatabaseService）
 */
class UserService implements IService {
  readonly serviceName = "UserService";
  isInitialized = false;

  private logger?: LoggerService;
  private db?: DatabaseService;

  async initialize(): Promise<void> {
    this.logger?.log("UserService 正在初始化...");
    console.log("✅ UserService 已初始化");
    this.isInitialized = true;
  }

  // 【关键方法2】注入多个依赖
  setDependencies(logger: LoggerService, db: DatabaseService): void {
    this.logger = logger;
    this.db = db;
  }

  getUser(id: number): any {
    this.logger?.log(`获取用户 ${id}`);
    const users = this.db?.query(`SELECT * FROM users WHERE id = ${id}`);
    return users?.[0];
  }
}

// ============================================
// 步骤2: 注册服务
// ============================================

/**
 * 【方式1】手动注入依赖（适合简单场景）
 */
async function example_ManualInjection(): Promise<void> {
  console.log("\n========== 方式1: 手动注入依赖 ==========\n");

  const container = new ServiceContainer("manual");

  // 注册服务
  container.addSingleton("LoggerService", LoggerService);
  container.addSingleton("DatabaseService", DatabaseService);
  container.addSingleton("UserService", UserService);

  // 获取服务
  const logger = await container.get<LoggerService>("LoggerService");
  const db = await container.get<DatabaseService>("DatabaseService");
  const userService = await container.get<UserService>("UserService");

  // 手动注入依赖
  db.setLogger(logger);
  userService.setDependencies(logger, db);

  // 使用服务
  const user = userService.getUser(1);
  console.log("\n获取到的用户:", user);

  await container.dispose();
}

/**
 * 【方式2】使用工厂函数自动注入（推荐）
 */
async function example_FactoryInjection(): Promise<void> {
  console.log("\n\n========== 方式2: 工厂函数自动注入（推荐）==========\n");

  const container = new ServiceContainer("factory");

  // 1. 注册 LoggerService（无依赖）
  container.addSingleton("LoggerService", LoggerService);

  // 2. 注册 DatabaseService（依赖 LoggerService）
  container.addFactory(
    "DatabaseService",
    async (container: ServiceContainer) => {
      // 【关键】从容器获取依赖的服务
      const logger = await container.get<LoggerService>("LoggerService");

      // 创建服务实例
      const db = new DatabaseService();
      db.setLogger(logger);

      // 初始化服务
      await db.initialize();

      return db;
    }
  );

  // 3. 注册 UserService（依赖 LoggerService 和 DatabaseService）
  container.addFactory(
    "UserService",
    async (container: ServiceContainer) => {
      // 【关键】从容器获取所有依赖
      const logger = await container.get<LoggerService>("LoggerService");
      const db = await container.get<DatabaseService>("DatabaseService");

      const userService = new UserService();
      userService.setDependencies(logger, db);
      await userService.initialize();

      return userService;
    }
  );

  // 直接使用，依赖自动解析
  const userService = await container.get<UserService>("UserService");
  const user = userService.getUser(1);
  console.log("\n获取到的用户:", user);

  await container.dispose();
}

/**
 * 【方式3】服务内部通过容器获取其他服务（最灵活）
 */
async function example_ServiceGetOtherService(): Promise<void> {
  console.log("\n\n========== 方式3: 服务内部获取其他服务（最灵活）==========\n");

  /**
   * 定义一个高级服务，内部通过容器获取其他服务
   */
  class AdvancedUserService implements IService {
    readonly serviceName = "AdvancedUserService";
    isInitialized = false;

    // 【关键】保存容器引用
    private container: ServiceContainer;

    // 服务依赖（延迟加载）
    private logger?: LoggerService;
    private db?: DatabaseService;

    constructor(config: { container: ServiceContainer }) {
      this.container = config.container;
    }

    async initialize(): Promise<void> {
      // 【关键】在初始化时从容器获取依赖
      this.logger = await this.container.get<LoggerService>("LoggerService");
      this.db = await this.container.get<DatabaseService>("DatabaseService");

      this.logger.log("AdvancedUserService 正在初始化...");
      console.log("✅ AdvancedUserService 已初始化");
      this.isInitialized = true;
    }

    async dispose(): Promise<void> {
      this.logger?.log("AdvancedUserService 正在销毁...");
    }

    /**
     * 业务方法示例
     */
    async getUserWithPosts(userId: number): Promise<any> {
      this.logger?.log(`获取用户 ${userId} 及其文章`);

      // 从数据库获取用户
      const users = this.db?.query(`SELECT * FROM users WHERE id = ${userId}`);
      const user = users?.[0];

      if (!user) {
        return null;
      }

      // 从数据库获取文章
      const posts = this.db?.query(`SELECT * FROM posts WHERE user_id = ${userId}`);

      return {
        ...user,
        posts
      };
    }

    /**
     * 【关键】如果需要动态获取其他服务
     */
    async doSomethingWithAnotherService(): Promise<void> {
      // 运行时动态获取服务
      const logger = await this.container.get<LoggerService>("LoggerService");
      logger.log("动态获取的服务也可以使用！");
    }
  }

  // 创建容器并注册服务
  const container = new ServiceContainer("advanced");

  // 注册基础服务
  container.addSingleton("LoggerService", LoggerService);

  container.addFactory(
    "DatabaseService",
    async (container: ServiceContainer) => {
      const logger = await container.get<LoggerService>("LoggerService");
      const db = new DatabaseService();
      db.setLogger(logger);
      await db.initialize();
      return db;
    }
  );

  // 注册高级服务（传递容器引用）
  container.addFactory(
    "AdvancedUserService",
    async (container: ServiceContainer) => {
      // 【关键】将容器传递给服务
      const service = new AdvancedUserService({ container });
      await service.initialize();
      return service;
    }
  );

  // 使用高级服务
  const advancedService = await container.get<AdvancedUserService>("AdvancedUserService");

  const userWithPosts = await advancedService.getUserWithPosts(1);
  console.log("\n用户及其文章:", userWithPosts);

  await advancedService.doSomethingWithAnotherService();

  await container.dispose();
}

// ============================================
// 主函数
// ============================================

async function main(): Promise<void> {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║    ServiceContainer 快速上手 - 三种依赖注入方式   ║");
  console.log("╚══════════════════════════════════════════════════╝");

  try {
    await example_ManualInjection();
    await example_FactoryInjection();
    await example_ServiceGetOtherService();

    console.log("\n\n╔══════════════════════════════════════════════════╗");
    console.log("║                  完成！                          ║");
    console.log("╚══════════════════════════════════════════════════╝\n");

    console.log("💡 核心要点总结:");
    console.log("1. 方式1：手动注入 - 简单但需要手动管理依赖");
    console.log("2. 方式2：工厂函数 - 推荐，依赖自动解析");
    console.log("3. 方式3：容器引用 - 最灵活，适合复杂场景\n");

  } catch (error: any) {
    console.error("❌ 错误:", error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
