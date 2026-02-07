// /**
//  * ============================================================
//  *  Container 依赖注入完整示例
//  * ============================================================
//  *
//  * 本示例展示了 Container 的所有核心特性：
//  *
//  *  1. @singleton()   — 单例装饰器
//  *  2. @transient()  — 瞬时装饰器（每次 resolve 创建新实例）
//  *  3. @inject(token) — 参数注入装饰器（字符串/Symbol/类 令牌）
//  *  4. @init()        — 初始化方法装饰器（创建后自动调用）
//  *  5. @dispose()     — 销毁方法装饰器（容器销毁时自动调用）
//  *  6. container.register()          — 通用注册（类/工厂/值）
//  *  7. container.registerSingleton() — 快捷注册单例
//  *  8. container.registerInstance()   — 注册已有实例/值
//  *  9. container.resolve()           — 解析服务（异步，自动注入依赖）
//  * 10. container.tryResolve()        — 安全解析（不抛异常）
//  * 11. container.isRegistered()      — 检查是否已注册
//  * 12. container.dispose()           — 销毁容器（调用所有 @dispose）
//  * 13. container.reset()             — 重置容器
//  * 14. container.debug()             — 打印调试信息
//  * 15. Lifecycle.Singleton / Transient — 生命周期控制
//  * 16. 循环依赖检测
//  * 17. 独立容器实例（模块级隔离）
//  *
//  * 运行方式：
//  *   npx ts-node examples/ContainerExample.ts
//  */

// import {
//   Container,
//   container,
//   singleton,
//   transient,
//   inject,
//   init,
//   dispose,
//   Lifecycle,
// } from "../src/Core";

// // ============================================================
// // 特性 1: @singleton() — 单例服务
// // ============================================================
// // 整个容器生命周期内只创建一个实例。
// // 多次 resolve 返回同一个对象。

// @singleton()
// class ConfigService {
//   readonly appName = "MyApp";
//   readonly version = "2.0.0";
//   readonly startedAt = new Date();
// }

// // ============================================================
// // 特性 2: @transient() — 瞬时服务
// // ============================================================
// // 每次 resolve 都会创建一个新实例。
// // 适用于无状态的工具类或需要独立实例的场景。

// @transient()
// class RequestContext {
//   readonly requestId = Math.random().toString(36).substring(2, 10);
//   readonly createdAt = new Date();
// }

// // ============================================================
// // 特性 3: @inject(token) — 参数注入
// // ============================================================
// // 使用字符串令牌注入配置值、API Key 等非类类型的依赖。
// // 也可以用 Symbol 或类作为令牌。

// // 定义一个 Symbol 令牌（类型安全，避免字符串冲突）
// const DB_CONNECTION_STRING = Symbol("DB_CONNECTION_STRING");

// @singleton()
// class ApiClient {
//   constructor(
//     // 使用字符串令牌注入
//     @inject("API_KEY") private apiKey: string,
//     @inject("API_BASE_URL") private baseUrl: string,
//     // 使用 Symbol 令牌注入
//     @inject(DB_CONNECTION_STRING) private dbConnStr: string
//   ) {}

//   getInfo(): string {
//     return `API: ${this.baseUrl} | Key: ${this.apiKey.substring(0, 8)}... | DB: ${this.dbConnStr}`;
//   }
// }

// // ============================================================
// // 特性 4 & 5: @init() 和 @dispose() — 生命周期钩子
// // ============================================================
// // @init()    标记的方法在实例创建后自动调用（支持异步）
// // @dispose() 标记的方法在容器销毁时自动调用（支持异步）

// @singleton()
// class DatabaseService {
//   private connected = false;
//   private connectionPool: string[] = [];

//   // 创建实例后自动调用
//   @init()
//   async connect(): Promise<void> {
//     // 模拟异步连接
//     await new Promise((resolve) => setTimeout(resolve, 100));
//     this.connected = true;
//     this.connectionPool = ["conn-1", "conn-2", "conn-3"];
//     console.log("  ✅ [DatabaseService] 数据库已连接，连接池大小:", this.connectionPool.length);
//   }

//   // 容器销毁时自动调用
//   @dispose()
//   async disconnect(): Promise<void> {
//     await new Promise((resolve) => setTimeout(resolve, 50));
//     this.connected = false;
//     this.connectionPool = [];
//     console.log("  🔴 [DatabaseService] 数据库已断开连接");
//   }

//   isConnected(): boolean {
//     return this.connected;
//   }

//   query(sql: string): string {
//     if (!this.connected) throw new Error("数据库未连接");
//     return `[查询结果] ${sql} (使用 ${this.connectionPool[0]})`;
//   }
// }

// // ============================================================
// // 特性 6: 自动依赖解析
// // ============================================================
// // 构造函数参数如果是已注册的类，会自动从容器中解析。
// // 无需手动传递依赖，容器会递归解析整个依赖树。

// @singleton()
// class CacheService {
//   private cache = new Map<string, any>();

//   @init()
//   async warmUp(): Promise<void> {
//     console.log("  ✅ [CacheService] 缓存已预热");
//   }

//   @dispose()
//   async flush(): Promise<void> {
//     this.cache.clear();
//     console.log("  🔴 [CacheService] 缓存已清空");
//   }

//   get(key: string): any {
//     return this.cache.get(key);
//   }

//   set(key: string, value: any): void {
//     this.cache.set(key, value);
//   }
// }

// @transient()
// class UserRepository {
//   // 自动注入 DatabaseService 和 CacheService（都是单例）
//   constructor(
//     private db: DatabaseService,
//     private cache: CacheService
//   ) {}

//   findUser(id: string): string {
//     // 先查缓存
//     const cached = this.cache.get(`user:${id}`);
//     if (cached) return cached;

//     // 查数据库
//     const result = this.db.query(`SELECT * FROM users WHERE id = '${id}'`);
//     this.cache.set(`user:${id}`, result);
//     return result;
//   }
// }

// // ============================================================
// // 特性 7: 工厂注册
// // ============================================================
// // 使用 useFactory 可以自定义实例创建逻辑。
// // 工厂函数接收容器实例，可以从中解析其他依赖。

// class HttpClient {
//   constructor(
//     public readonly baseUrl: string,
//     public readonly timeout: number
//   ) {}

//   request(path: string): string {
//     return `GET ${this.baseUrl}${path} (timeout: ${this.timeout}ms)`;
//   }
// }

// // ============================================================
// // 特性 8: 接口注入（使用抽象类作为令牌）
// // ============================================================
// // TypeScript 接口在运行时不存在，所以用抽象类作为注入令牌。

// abstract class ILogger {
//   abstract log(message: string): void;
//   abstract warn(message: string): void;
//   abstract error(message: string): void;
// }

// @transient()
// class ConsoleLogger extends ILogger {
//   log(message: string): void {
//     console.log(`    📝 [LOG] ${message}`);
//   }
//   warn(message: string): void {
//     console.log(`    ⚠️ [WARN] ${message}`);
//   }
//   error(message: string): void {
//     console.log(`    ❌ [ERROR] ${message}`);
//   }
// }

// // ============================================================
// // 综合服务：使用多种注入方式
// // ============================================================

// @singleton()
// class UserService {
//   constructor(
//     private config: ConfigService,        // 自动注入单例
//     private db: DatabaseService,          // 自动注入单例
//     @inject(ILogger) private logger: ILogger,  // 通过抽象类令牌注入
//     @inject("API_KEY") private apiKey: string  // 通过字符串令牌注入
//   ) {}

//   @init()
//   async setup(): Promise<void> {
//     this.logger.log(`UserService 已初始化 (${this.config.appName} v${this.config.version})`);
//   }

//   @dispose()
//   async teardown(): Promise<void> {
//     this.logger.log("UserService 已销毁");
//   }

//   getUser(id: string): string {
//     this.logger.log(`查询用户: ${id}`);
//     return this.db.query(`SELECT * FROM users WHERE id = '${id}'`);
//   }
// }

// // ============================================================
// // 主函数：演示所有特性
// // ============================================================

// async function main() {
//   console.log("╔══════════════════════════════════════════════╗");
//   console.log("║     Container 依赖注入 - 完整特性演示       ║");
//   console.log("╚══════════════════════════════════════════════╝\n");

//   // ----------------------------------------------------------
//   // 1. 注册配置值（字符串令牌 + Symbol 令牌）
//   // ----------------------------------------------------------
//   console.log("📦 [步骤 1] 注册配置值\n");

//   container.registerInstance("API_KEY", "sk-abcdef1234567890");
//   container.registerInstance("API_BASE_URL", "https://api.example.com");
//   container.registerInstance(DB_CONNECTION_STRING, "postgresql://localhost:5432/mydb");

//   console.log("  已注册: API_KEY, API_BASE_URL, DB_CONNECTION_STRING\n");

//   // ----------------------------------------------------------
//   // 2. 注册接口实现
//   // ----------------------------------------------------------
//   console.log("📦 [步骤 2] 注册接口实现\n");

//   // ILogger -> ConsoleLogger（单例）
//   container.register(ILogger, { useClass: ConsoleLogger }, Lifecycle.Singleton);
//   console.log("  已注册: ILogger -> ConsoleLogger\n");

//   // ----------------------------------------------------------
//   // 3. 注册工厂
//   // ----------------------------------------------------------
//   console.log("📦 [步骤 3] 注册工厂\n");

//   container.register(
//     "HttpClient",
//     {
//       useFactory: async (c: Container) => {
//         // 工厂函数可以从容器中解析其他依赖
//         const baseUrl = await c.resolve<string>("API_BASE_URL");
//         return new HttpClient(baseUrl, 5000);
//       },
//     },
//     Lifecycle.Singleton
//   );
//   console.log("  已注册: HttpClient (工厂模式)\n");

//   // ----------------------------------------------------------
//   // 4. 解析服务（自动创建 + 注入依赖 + 调用 @init）
//   // ----------------------------------------------------------
//   console.log("🔧 [步骤 4] 解析服务（触发 @init）\n");

//   const db = await container.resolve(DatabaseService);
//   const cache = await container.resolve(CacheService);
//   const userService = await container.resolve(UserService);
//   const apiClient = await container.resolve(ApiClient);

//   console.log();

//   // ----------------------------------------------------------
//   // 5. 使用服务
//   // ----------------------------------------------------------
//   console.log("🚀 [步骤 5] 使用服务\n");

//   // 使用 UserService（内部自动注入了 DB、Logger、Config）
//   const user = userService.getUser("user-001");
//   console.log(`  查询结果: ${user}`);

//   // 使用 ApiClient（注入了字符串和 Symbol 令牌）
//   console.log(`  API 信息: ${apiClient.getInfo()}`);

//   // 使用工厂创建的 HttpClient
//   const httpClient = await container.resolve<HttpClient>("HttpClient");
//   console.log(`  HTTP 请求: ${httpClient.request("/users")}`);

//   console.log();

//   // ----------------------------------------------------------
//   // 6. 单例验证
//   // ----------------------------------------------------------
//   console.log("🔒 [步骤 6] 单例验证\n");

//   const db2 = await container.resolve(DatabaseService);
//   console.log(`  DatabaseService 是同一实例: ${db === db2}`);  // true

//   const config1 = await container.resolve(ConfigService);
//   const config2 = await container.resolve(ConfigService);
//   console.log(`  ConfigService 是同一实例: ${config1 === config2}`);  // true

//   console.log();

//   // ----------------------------------------------------------
//   // 7. 瞬时服务验证（@transient）
//   // ----------------------------------------------------------
//   console.log("🔄 [步骤 7] 瞬时服务验证（每次创建新实例）\n");

//   const ctx1 = await container.resolve(RequestContext);
//   const ctx2 = await container.resolve(RequestContext);
//   console.log(`  RequestContext #1: ${ctx1.requestId}`);
//   console.log(`  RequestContext #2: ${ctx2.requestId}`);
//   console.log(`  是不同实例: ${ctx1 !== ctx2}`);  // true

//   console.log();

//   // ----------------------------------------------------------
//   // 8. tryResolve — 安全解析
//   // ----------------------------------------------------------
//   console.log("🛡️ [步骤 8] 安全解析（tryResolve）\n");

//   const existing = await container.tryResolve(DatabaseService);
//   console.log(`  已注册的服务: ${existing !== null}`);  // true

//   const missing = await container.tryResolve("NonExistentService");
//   console.log(`  未注册的服务: ${missing}`);  // null（不会抛异常）

//   console.log();

//   // ----------------------------------------------------------
//   // 9. isRegistered — 检查注册状态
//   // ----------------------------------------------------------
//   console.log("🔍 [步骤 9] 检查注册状态\n");

//   console.log(`  DatabaseService 已注册: ${container.isRegistered(DatabaseService)}`);  // true
//   console.log(`  "API_KEY" 已注册: ${container.isRegistered("API_KEY")}`);  // true
//   console.log(`  "UNKNOWN" 已注册: ${container.isRegistered("UNKNOWN")}`);  // false

//   console.log();

//   // ----------------------------------------------------------
//   // 10. debug — 打印容器状态
//   // ----------------------------------------------------------
//   console.log("🐛 [步骤 10] 容器调试信息");
//   container.debug();

//   // ----------------------------------------------------------
//   // 11. 独立容器（模块级隔离）
//   // ----------------------------------------------------------
//   console.log("📦 [步骤 11] 独立容器（模块级隔离）\n");

//   const moduleContainer = new Container();
//   moduleContainer.registerInstance("MODULE_NAME", "MemoryModule");
//   moduleContainer.registerInstance("API_KEY", "module-specific-key");

//   const moduleName = await moduleContainer.resolve<string>("MODULE_NAME");
//   const moduleKey = await moduleContainer.resolve<string>("API_KEY");
//   console.log(`  模块容器 - 名称: ${moduleName}, Key: ${moduleKey}`);

//   // 全局容器不受影响
//   const globalKey = await container.resolve<string>("API_KEY");
//   console.log(`  全局容器 - Key: ${globalKey.substring(0, 12)}...`);
//   console.log(`  两个容器互不影响: ${moduleKey !== globalKey}`);  // true

//   // 清理模块容器
//   moduleContainer.reset();
//   console.log(`  模块容器已重置\n`);

//   // ----------------------------------------------------------
//   // 12. 循环依赖检测
//   // ----------------------------------------------------------
//   console.log("🔄 [步骤 12] 循环依赖检测\n");

//   try {
//     const testContainer = new Container();
//     // 模拟循环依赖：A -> B -> A
//     testContainer.register("A", {
//       useFactory: async (c: Container) => {
//         await c.resolve("B");
//         return "A";
//       },
//     }, Lifecycle.Singleton);
//     testContainer.register("B", {
//       useFactory: async (c: Container) => {
//         await c.resolve("A");
//         return "B";
//       },
//     }, Lifecycle.Singleton);

//     await testContainer.resolve("A");
//   } catch (error: any) {
//     console.log(`  ✅ 循环依赖已被检测: ${error.message}\n`);
//   }

//   // ----------------------------------------------------------
//   // 13. dispose — 销毁容器
//   // ----------------------------------------------------------
//   console.log("💥 [步骤 13] 销毁容器（触发所有 @dispose）\n");

//   await container.dispose();

//   console.log("\n✨ 演示完成！");
// }

// // 运行
// main().catch(console.error);
