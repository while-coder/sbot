/**
 * ServiceContainer 完整示例
 * 演示如何使用服务容器进行依赖注入和服务管理
 *
 * 运行方式:
 *   npx ts-node examples/ServiceContainerExample.ts
 */

import { ServiceContainer, IService, ServiceLifetime } from "../src/Core";

// ============================================
// 1. 定义服务接口和实现
// ============================================

/**
 * 日志服务 - 单例服务
 * 全局唯一，所有地方共享同一个实例
 */
class LogService implements IService {
  readonly serviceName = "LogService";
  isInitialized = false;

  private logCount = 0;

  async initialize(): Promise<void> {
    console.log("📦 [LogService] 初始化中...");
    this.isInitialized = true;
  }

  async dispose(): Promise<void> {
    console.log(`📦 [LogService] 销毁中... (共记录 ${this.logCount} 条日志)`);
  }

  log(message: string): void {
    this.logCount++;
    console.log(`📝 [${new Date().toISOString()}] ${message}`);
  }

  getLogCount(): number {
    return this.logCount;
  }
}

/**
 * 数据库服务配置接口
 */
interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
}

/**
 * 数据库服务 - 单例服务
 * 依赖 LogService
 */
class DatabaseService implements IService {
  readonly serviceName = "DatabaseService";
  isInitialized = false;

  private config: DatabaseConfig;
  private connected = false;
  private logService?: LogService; // 依赖的服务

  constructor(config: DatabaseConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    this.logService?.log(`[DatabaseService] 连接到数据库 ${this.config.host}:${this.config.port}`);
    // 模拟连接
    await new Promise(resolve => setTimeout(resolve, 100));
    this.connected = true;
    this.isInitialized = true;
    this.logService?.log("[DatabaseService] 数据库连接成功");
  }

  async dispose(): Promise<void> {
    this.logService?.log("[DatabaseService] 断开数据库连接");
    this.connected = false;
  }

  /**
   * 【关键】在服务中注入其他服务的方法
   * 通过 setLogService 注入依赖
   */
  setLogService(logService: LogService): void {
    this.logService = logService;
  }

  query(sql: string): any[] {
    this.logService?.log(`[DatabaseService] 执行查询: ${sql}`);
    return [
      { id: 1, name: "User 1" },
      { id: 2, name: "User 2" }
    ];
  }

  isConnected(): boolean {
    return this.connected;
  }
}

/**
 * 用户会话服务 - 作用域服务
 * 每个用户（作用域）有独立的实例
 */
class UserSessionService implements IService {
  readonly serviceName = "UserSessionService";
  isInitialized = false;

  private userId: string;
  private sessionData: Map<string, any> = new Map();
  private logService?: LogService;

  constructor(config: { userId: string }) {
    this.userId = config.userId;
  }

  async initialize(): Promise<void> {
    this.logService?.log(`[UserSessionService] 为用户 ${this.userId} 创建会话`);
    this.isInitialized = true;
  }

  async dispose(): Promise<void> {
    this.logService?.log(`[UserSessionService] 销毁用户 ${this.userId} 的会话`);
    this.sessionData.clear();
  }

  setLogService(logService: LogService): void {
    this.logService = logService;
  }

  setData(key: string, value: any): void {
    this.sessionData.set(key, value);
    this.logService?.log(`[UserSessionService] 用户 ${this.userId} 设置数据: ${key}`);
  }

  getData(key: string): any {
    return this.sessionData.get(key);
  }

  getUserId(): string {
    return this.userId;
  }
}

/**
 * 请求处理服务 - 瞬时服务
 * 每次请求都创建新实例
 */
class RequestHandlerService implements IService {
  readonly serviceName = "RequestHandlerService";
  isInitialized = false;

  private requestId: string;
  private logService?: LogService;
  private dbService?: DatabaseService;

  constructor(config: { requestId: string }) {
    this.requestId = config.requestId;
  }

  async initialize(): Promise<void> {
    this.logService?.log(`[RequestHandlerService] 创建请求处理器: ${this.requestId}`);
    this.isInitialized = true;
  }

  async dispose(): Promise<void> {
    this.logService?.log(`[RequestHandlerService] 销毁请求处理器: ${this.requestId}`);
  }

  setDependencies(logService: LogService, dbService: DatabaseService): void {
    this.logService = logService;
    this.dbService = dbService;
  }

  handleRequest(query: string): any {
    this.logService?.log(`[RequestHandlerService] 处理请求 ${this.requestId}: ${query}`);
    const results = this.dbService?.query(query);
    return { requestId: this.requestId, results };
  }
}

// ============================================
// 2. 注册服务（三种方式）
// ============================================

/**
 * 方式1: 基础注册 - 手动注入依赖
 */
function setupBasicServices(container: ServiceContainer): void {
  console.log("\n========== 方式1: 基础服务注册 ==========\n");

  // 注册日志服务（单例）
  container.addSingleton("LogService", LogService);

  // 注册数据库服务（单例，带配置）
  container.addSingleton("DatabaseService", DatabaseService, {
    enabled: true,
    config: {
      host: "localhost",
      port: 5432,
      database: "myapp"
    }
  });
}

/**
 * 方式2: 使用工厂函数注册 - 自动解析依赖
 */
function setupFactoryServices(container: ServiceContainer): void {
  console.log("\n========== 方式2: 工厂函数注册（推荐）==========\n");

  // 注册日志服务（单例）
  container.addSingleton("LogService", LogService);

  // 使用工厂函数注册数据库服务，自动注入依赖
  container.addFactory(
    "DatabaseService",
    async (container: ServiceContainer) => {
      const logService = await container.get<LogService>("LogService");

      const dbService = new DatabaseService({
        host: "localhost",
        port: 5432,
        database: "myapp"
      });

      // 注入依赖
      dbService.setLogService(logService);

      // 手动初始化
      await dbService.initialize();

      return dbService;
    },
    ServiceLifetime.SINGLETON
  );
}

/**
 * 方式3: 完整的依赖注入系统
 */
function setupFullDIServices(container: ServiceContainer): void {
  console.log("\n========== 方式3: 完整依赖注入系统 ==========\n");

  // 1. 注册日志服务（单例）
  container.addSingleton("LogService", LogService);

  // 2. 注册数据库服务（单例，工厂模式）
  container.addFactory(
    "DatabaseService",
    async (container: ServiceContainer) => {
      const logService = await container.get<LogService>("LogService");
      const dbService = new DatabaseService({
        host: "localhost",
        port: 5432,
        database: "myapp"
      });
      dbService.setLogService(logService);
      await dbService.initialize();
      return dbService;
    },
    ServiceLifetime.SINGLETON
  );

  // 3. 注册用户会话服务（作用域）
  container.addFactory(
    "UserSessionService",
    async (container: ServiceContainer) => {
      const logService = await container.get<LogService>("LogService");

      // 从容器名称中提取 userId（简化示例）
      const userId = "unknown"; // 实际应从上下文获取

      const sessionService = new UserSessionService({ userId });
      sessionService.setLogService(logService);
      await sessionService.initialize();
      return sessionService;
    },
    ServiceLifetime.SCOPED
  );

  // 4. 注册请求处理服务（瞬时）
  container.addFactory(
    "RequestHandlerService",
    async (container: ServiceContainer) => {
      const logService = await container.get<LogService>("LogService");
      const dbService = await container.get<DatabaseService>("DatabaseService");

      const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const requestHandler = new RequestHandlerService({ requestId });
      requestHandler.setDependencies(logService, dbService);
      await requestHandler.initialize();
      return requestHandler;
    },
    ServiceLifetime.TRANSIENT
  );
}

// ============================================
// 3. 使用服务的示例
// ============================================

/**
 * 示例1: 基础使用 - 手动注入依赖
 */
async function example1_BasicUsage(): Promise<void> {
  console.log("\n\n========================================");
  console.log("示例1: 基础使用（手动注入依赖）");
  console.log("========================================\n");

  const container = new ServiceContainer("example1");
  setupBasicServices(container);

  // 获取服务
  const logService = await container.get<LogService>("LogService");
  const dbService = await container.get<DatabaseService>("DatabaseService");

  // 手动注入依赖
  dbService.setLogService(logService);

  // 使用服务
  logService.log("应用启动");
  const results = dbService.query("SELECT * FROM users");
  console.log("查询结果:", results);

  // 清理
  await container.dispose();
}

/**
 * 示例2: 工厂函数 - 自动解析依赖
 */
async function example2_FactoryPattern(): Promise<void> {
  console.log("\n\n========================================");
  console.log("示例2: 工厂函数（自动解析依赖）");
  console.log("========================================\n");

  const container = new ServiceContainer("example2");
  setupFactoryServices(container);

  // 直接获取服务，依赖自动注入
  const dbService = await container.get<DatabaseService>("DatabaseService");
  const logService = await container.get<LogService>("LogService");

  // 使用服务
  logService.log("开始查询用户数据");
  const results = dbService.query("SELECT * FROM users WHERE active = true");
  console.log("查询结果:", results);
  console.log("总日志数:", logService.getLogCount());

  // 清理
  await container.dispose();
}

/**
 * 示例3: 作用域服务 - 多用户场景
 */
async function example3_ScopedServices(): Promise<void> {
  console.log("\n\n========================================");
  console.log("示例3: 作用域服务（多用户场景）");
  console.log("========================================\n");

  const rootContainer = new ServiceContainer("root");
  setupFullDIServices(rootContainer);

  // 创建用户1的作用域
  const user1Container = rootContainer.createScope("user:alice");

  // 为用户1注册会话服务
  user1Container.addFactory(
    "UserSessionService",
    async (container: ServiceContainer) => {
      const logService = await rootContainer.get<LogService>("LogService");
      const sessionService = new UserSessionService({ userId: "alice" });
      sessionService.setLogService(logService);
      await sessionService.initialize();
      return sessionService;
    },
    ServiceLifetime.SCOPED
  );

  // 创建用户2的作用域
  const user2Container = rootContainer.createScope("user:bob");

  // 为用户2注册会话服务
  user2Container.addFactory(
    "UserSessionService",
    async (container: ServiceContainer) => {
      const logService = await rootContainer.get<LogService>("LogService");
      const sessionService = new UserSessionService({ userId: "bob" });
      sessionService.setLogService(logService);
      await sessionService.initialize();
      return sessionService;
    },
    ServiceLifetime.SCOPED
  );

  // 获取各自的会话服务
  const session1 = await user1Container.get<UserSessionService>("UserSessionService");
  const session2 = await user2Container.get<UserSessionService>("UserSessionService");

  // 设置会话数据
  session1.setData("theme", "dark");
  session1.setData("language", "zh-CN");

  session2.setData("theme", "light");
  session2.setData("language", "en-US");

  console.log("\n用户1的会话数据:");
  console.log("  theme:", session1.getData("theme"));
  console.log("  language:", session1.getData("language"));

  console.log("\n用户2的会话数据:");
  console.log("  theme:", session2.getData("theme"));
  console.log("  language:", session2.getData("language"));

  // 验证单例服务是共享的
  const logService = await rootContainer.get<LogService>("LogService");
  console.log("\n共享的日志服务统计:", logService.getLogCount(), "条日志");

  // 清理
  await user1Container.dispose();
  await user2Container.dispose();
  await rootContainer.dispose();
}

/**
 * 示例4: 瞬时服务 - 每次请求创建新实例
 */
async function example4_TransientServices(): Promise<void> {
  console.log("\n\n========================================");
  console.log("示例4: 瞬时服务（每次请求新实例）");
  console.log("========================================\n");

  const container = new ServiceContainer("example4");
  setupFullDIServices(container);

  // 模拟3个并发请求
  console.log("\n模拟3个并发请求:\n");

  const handler1 = await container.get<RequestHandlerService>("RequestHandlerService");
  const handler2 = await container.get<RequestHandlerService>("RequestHandlerService");
  const handler3 = await container.get<RequestHandlerService>("RequestHandlerService");

  const result1 = handler1.handleRequest("SELECT * FROM orders WHERE status = 'pending'");
  const result2 = handler2.handleRequest("SELECT * FROM products WHERE stock > 0");
  const result3 = handler3.handleRequest("SELECT * FROM users WHERE last_login > NOW() - INTERVAL '7 days'");

  console.log("\n请求1结果:", result1.requestId);
  console.log("请求2结果:", result2.requestId);
  console.log("请求3结果:", result3.requestId);

  // 验证是不同的实例
  console.log("\n三个处理器是否为不同实例:",
    handler1 !== handler2 &&
    handler2 !== handler3 &&
    handler1 !== handler3
  );

  // 清理
  await container.dispose();
}

/**
 * 示例5: 在服务内部获取其他服务的完整示例
 */
async function example5_ServiceGetOtherService(): Promise<void> {
  console.log("\n\n========================================");
  console.log("示例5: 服务内部获取其他服务");
  console.log("========================================\n");

  // 定义一个复杂的业务服务
  class UserBusinessService implements IService {
    readonly serviceName = "UserBusinessService";
    isInitialized = false;

    private container: ServiceContainer;
    private logService?: LogService;
    private dbService?: DatabaseService;

    /**
     * 【关键】构造函数接收容器引用
     */
    constructor(config: { container: ServiceContainer }) {
      this.container = config.container;
    }

    async initialize(): Promise<void> {
      // 【关键】在初始化时从容器获取其他服务
      this.logService = await this.container.get<LogService>("LogService");
      this.dbService = await this.container.get<DatabaseService>("DatabaseService");

      this.logService.log("[UserBusinessService] 业务服务初始化完成");
      this.isInitialized = true;
    }

    async dispose(): Promise<void> {
      this.logService?.log("[UserBusinessService] 业务服务销毁");
    }

    /**
     * 业务方法：获取用户列表
     */
    async getUserList(): Promise<any[]> {
      this.logService?.log("[UserBusinessService] 获取用户列表");

      // 使用数据库服务
      const users = this.dbService?.query("SELECT * FROM users");

      return users || [];
    }

    /**
     * 业务方法：创建用户
     */
    async createUser(name: string): Promise<any> {
      this.logService?.log(`[UserBusinessService] 创建用户: ${name}`);

      // 模拟数据库操作
      const newUser = { id: Date.now(), name };
      this.dbService?.query(`INSERT INTO users (name) VALUES ('${name}')`);

      return newUser;
    }
  }

  // 创建容器并注册服务
  const container = new ServiceContainer("example5");
  setupFactoryServices(container);

  // 注册业务服务，传递容器引用
  container.addFactory(
    "UserBusinessService",
    async (container: ServiceContainer) => {
      const service = new UserBusinessService({ container });
      await service.initialize();
      return service;
    },
    ServiceLifetime.SINGLETON
  );

  // 使用业务服务
  const businessService = await container.get<UserBusinessService>("UserBusinessService");

  const users = await businessService.getUserList();
  console.log("\n当前用户列表:", users);

  const newUser = await businessService.createUser("张三");
  console.log("\n新创建的用户:", newUser);

  // 清理
  await container.dispose();
}

/**
 * 示例6: 调试和检查容器状态
 */
async function example6_ContainerDebug(): Promise<void> {
  console.log("\n\n========================================");
  console.log("示例6: 容器调试和状态检查");
  console.log("========================================\n");

  const container = new ServiceContainer("debug-example");
  setupFullDIServices(container);

  // 检查服务是否已注册
  console.log("\nLogService 是否已注册:", container.has("LogService"));
  console.log("DatabaseService 是否已注册:", container.has("DatabaseService"));
  console.log("UnknownService 是否已注册:", container.has("UnknownService"));

  // 获取所有已注册的服务名称
  console.log("\n所有已注册的服务:");
  const serviceNames = container.getServiceNames();
  serviceNames.forEach(name => console.log(`  - ${name}`));

  // 获取一些服务实例（触发实例化）
  await container.get<LogService>("LogService");
  await container.get<DatabaseService>("DatabaseService");

  // 打印容器详细信息
  container.debug();

  // 创建子容器
  const childContainer = container.createScope("child");

  // 在子容器中注册作用域服务
  childContainer.addFactory(
    "UserSessionService",
    async (container: ServiceContainer) => {
      const logService = await container.get<LogService>("LogService");
      const sessionService = new UserSessionService({ userId: "test-user" });
      sessionService.setLogService(logService);
      await sessionService.initialize();
      return sessionService;
    },
    ServiceLifetime.SCOPED
  );

  await childContainer.get<UserSessionService>("UserSessionService");

  console.log("\n子容器信息:");
  childContainer.debug();

  // 清理
  await childContainer.dispose();
  await container.dispose();
}

// ============================================
// 主函数
// ============================================

async function main(): Promise<void> {
  console.log("\n");
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║         ServiceContainer 完整示例集合                       ║");
  console.log("╚════════════════════════════════════════════════════════════╝");

  try {
    // 运行所有示例
    await example1_BasicUsage();
    await example2_FactoryPattern();
    await example3_ScopedServices();
    await example4_TransientServices();
    await example5_ServiceGetOtherService();  // 核心示例
    await example6_ContainerDebug();

    console.log("\n\n");
    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║                所有示例运行完成！                           ║");
    console.log("╚════════════════════════════════════════════════════════════╝");
    console.log("\n");

  } catch (error: any) {
    console.error("\n❌ 错误:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// 运行示例
if (require.main === module) {
  main();
}

// 导出供其他模块使用
export {
  LogService,
  DatabaseService,
  UserSessionService,
  RequestHandlerService,
  setupBasicServices,
  setupFactoryServices,
  setupFullDIServices
};
