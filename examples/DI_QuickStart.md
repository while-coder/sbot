# 依赖注入快速入门

本项目的 Service 模块参考 [tsyringe](https://github.com/microsoft/tsyringe) 设计，提供简洁的装饰器风格依赖注入。

## 核心 API

| API | 说明 |
|-----|------|
| `@singleton()` | 标记类为单例（整个应用只创建一次） |
| `@injectable()` | 标记类为可注入（每次 resolve 创建新实例） |
| `@inject(token)` | 指定构造函数参数的注入令牌 |
| `@init()` | 标记初始化方法（创建后自动调用） |
| `@dispose()` | 标记销毁方法（容器销毁时自动调用） |
| `container` | 全局容器实例 |

## 对比：旧 API vs 新 API

### 旧 API（繁琐）

```ts
// 1. 必须实现 IService 接口
class MyService implements IService {
  readonly serviceName = "MyService";
  isInitialized = false;

  constructor(config: Record<string, any>) {
    // ...
  }

  async initialize(): Promise<void> {
    this.isInitialized = true;
  }

  async dispose(): Promise<void> {
    this.isInitialized = false;
  }
}

// 2. 手动注册（字符串名称，容易出错）
container.addSingleton("MyService", MyService, {
  enabled: true,
  config: { apiKey: "xxx" }
});

// 3. 获取时需要类型断言
const service = await container.get<MyService>("MyService");
```

### 新 API（简洁）

```ts
// 1. 只需加装饰器
@singleton()
class MyService {
  constructor(@inject("API_KEY") private apiKey: string) {}

  @init()
  async initialize() { /* ... */ }

  @dispose()
  async cleanup() { /* ... */ }
}

// 2. 注册配置值
container.registerInstance("API_KEY", "xxx");

// 3. 类型安全的解析（自动注入依赖、自动初始化）
const service = await container.resolve(MyService);
```

## 使用示例

### 1. 最简单的单例服务

```ts
import { singleton, container } from "../src/Core";

@singleton()
class ConfigService {
  readonly appName = "MyApp";
  readonly version = "1.0.0";
}

const config = await container.resolve(ConfigService);
console.log(config.appName); // "MyApp"
```

### 2. 带初始化和销毁的服务

```ts
import { singleton, init, dispose, container } from "../src/Core";

@singleton()
class DatabaseService {
  private connected = false;

  @init()
  async connect() {
    console.log("数据库连接中...");
    this.connected = true;
  }

  @dispose()
  async disconnect() {
    console.log("数据库断开连接...");
    this.connected = false;
  }

  isConnected() { return this.connected; }
}

// resolve 时自动调用 @init() 方法
const db = await container.resolve(DatabaseService);
console.log(db.isConnected()); // true

// 容器销毁时自动调用 @dispose() 方法
await container.dispose();
```

### 3. 自动注入依赖

```ts
import { singleton, injectable, container } from "../src/Core";

@singleton()
class LoggerService {
  log(msg: string) { console.log(msg); }
}

@singleton()
class DatabaseService {
  query(sql: string) { return []; }
}

// 构造函数参数会自动从容器中解析
@injectable()
class UserService {
  constructor(
    private logger: LoggerService,
    private db: DatabaseService
  ) {}

  getUsers() {
    this.logger.log("查询用户...");
    return this.db.query("SELECT * FROM users");
  }
}

const userService = await container.resolve(UserService);
userService.getUsers();
```

### 4. 使用字符串令牌注入值

```ts
import { singleton, inject, container } from "../src/Core";

// 注册配置值
container.registerInstance("API_KEY", "sk-1234567890");
container.registerInstance("API_URL", "https://api.example.com");

@singleton()
class ApiService {
  constructor(
    @inject("API_KEY") private apiKey: string,
    @inject("API_URL") private apiUrl: string
  ) {}

  call() {
    return fetch(this.apiUrl, {
      headers: { Authorization: `Bearer ${this.apiKey}` }
    });
  }
}

const api = await container.resolve(ApiService);
```

### 5. 使用工厂函数

```ts
import { container, Lifecycle } from "../src/Core";

class ExternalClient {
  constructor(public readonly url: string) {}
}

container.register("ExternalClient", {
  useFactory: async (c) => {
    const url = await c.resolve("API_URL");
    return new ExternalClient(url);
  }
}, Lifecycle.Singleton);

const client = await container.resolve<ExternalClient>("ExternalClient");
```

### 6. 注册接口的实现

```ts
import { injectable, container, Lifecycle } from "../src/Core";

// 抽象类作为令牌
abstract class ILogger {
  abstract log(msg: string): void;
}

@injectable()
class ConsoleLogger extends ILogger {
  log(msg: string) { console.log(`[LOG] ${msg}`); }
}

// 注册：ILogger -> ConsoleLogger
container.register(ILogger, { useClass: ConsoleLogger }, Lifecycle.Singleton);

const logger = await container.resolve(ILogger);
logger.log("Hello!"); // [LOG] Hello!
```

## 容器 API 速查

```ts
// 注册
container.register(token, provider, lifecycle?)  // 通用注册
container.registerSingleton(Class)               // 注册单例类
container.registerSingleton("token", Class)      // 用令牌注册单例
container.registerInstance("token", value)       // 注册已有实例/值

// 解析
await container.resolve(Class)                   // 解析服务
await container.resolve<T>("token")              // 用令牌解析
await container.tryResolve(Class)                // 尝试解析（不抛异常）

// 查询
container.isRegistered(token)                    // 检查是否已注册

// 生命周期
await container.dispose()                        // 销毁容器
container.reset()                                // 重置容器
container.debug()                                // 打印调试信息
```

## 与 tsyringe 的对比

| 特性 | tsyringe | 本项目 |
|------|----------|--------|
| `@injectable()` | ✅ | ✅ |
| `@singleton()` | ✅ | ✅ |
| `@inject()` | ✅ | ✅ |
| `@init()` | ❌ | ✅ 自动初始化 |
| `@dispose()` | ❌ | ✅ 自动销毁 |
| `container.resolve()` | 同步 | **异步**（支持异步初始化） |
| 循环依赖检测 | ✅ | ✅ |
| 工厂注册 | ✅ | ✅ |
| 值注册 | ✅ | ✅ |

主要区别：`resolve()` 是异步的，因为支持异步的 `@init()` 方法和异步工厂函数。
