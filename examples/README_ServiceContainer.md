# ServiceContainer 使用指南

## 📚 目录

- [什么是 ServiceContainer](#什么是-servicecontainer)
- [核心概念](#核心概念)
- [快速开始](#快速开始)
- [服务生命周期](#服务生命周期)
- [依赖注入的三种方式](#依赖注入的三种方式)
- [实际应用场景](#实际应用场景)
- [运行示例](#运行示例)
- [常见问题](#常见问题)

---

## 什么是 ServiceContainer

ServiceContainer 是一个**依赖注入容器**（DI Container），类似于：

- .NET 的 `IServiceCollection` / `IServiceProvider`
- Java Spring 的 `ApplicationContext`
- NestJS 的 DI 系统

它帮助你：

✅ **解耦代码** - 服务之间不直接依赖，通过容器管理
✅ **管理生命周期** - 自动创建、初始化和销毁服务
✅ **简化测试** - 轻松替换服务实现进行单元测试
✅ **延迟加载** - 服务在真正需要时才被创建

---

## 核心概念

### 1. IService 接口

所有服务必须实现 `IService` 接口：

```typescript
export interface IService {
  readonly serviceName: string;        // 服务名称
  initialize?(): Promise<void>;        // 初始化方法（可选）
  dispose?(): Promise<void>;           // 销毁方法（可选）
  isInitialized?: boolean;             // 初始化状态（可选）
}
```

### 2. 三种服务生命周期

| 生命周期 | 说明 | 使用场景 |
|---------|------|---------|
| **SINGLETON** | 应用启动时创建一次，全局共享 | 配置服务、日志服务、数据库连接池 |
| **SCOPED** | 每个作用域（如用户会话）创建一次 | 用户会话、请求上下文 |
| **TRANSIENT** | 每次请求都创建新实例 | 短期任务处理器、临时计算服务 |

### 3. ServiceContainer 主要方法

```typescript
// 注册服务
container.addSingleton(name, implementation, config?)
container.addScoped(name, implementation, config?)
container.addTransient(name, implementation, config?)
container.addFactory(name, factory, lifetime, config?)

// 获取服务
await container.get<T>(name)          // 获取服务（失败抛异常）
await container.tryGet<T>(name)       // 安全获取（失败返回 null）

// 检查和管理
container.has(name)                   // 检查服务是否已注册
container.createScope(scopeName)      // 创建子容器
await container.dispose()             // 释放所有服务
```

---

## 快速开始

### 第一步：定义服务

```typescript
import { IService } from "../src/Core";

class MyService implements IService {
  readonly serviceName = "MyService";
  isInitialized = false;

  async initialize(): Promise<void> {
    console.log("服务初始化");
    this.isInitialized = true;
  }

  async dispose(): Promise<void> {
    console.log("服务销毁");
  }

  doSomething(): string {
    return "Hello from MyService!";
  }
}
```

### 第二步：注册服务

```typescript
import { ServiceContainer } from "../src/Core";

const container = new ServiceContainer("my-app");

// 注册单例服务
container.addSingleton("MyService", MyService);
```

### 第三步：使用服务

```typescript
// 获取服务
const myService = await container.get<MyService>("MyService");

// 使用服务
const result = myService.doSomething();
console.log(result); // "Hello from MyService!"

// 释放资源
await container.dispose();
```

---

## 服务生命周期

### SINGLETON 示例

```typescript
// 日志服务应该是单例
container.addSingleton("LogService", LogService);

const log1 = await container.get<LogService>("LogService");
const log2 = await container.get<LogService>("LogService");

console.log(log1 === log2); // true - 同一个实例
```

### SCOPED 示例

```typescript
// 用户会话服务应该是作用域
const rootContainer = new ServiceContainer("root");
rootContainer.addScoped("UserSession", UserSessionService);

// 为每个用户创建独立的作用域
const user1Container = rootContainer.createScope("user1");
const user2Container = rootContainer.createScope("user2");

const session1 = await user1Container.get<UserSessionService>("UserSession");
const session2 = await user2Container.get<UserSessionService>("UserSession");

console.log(session1 === session2); // false - 不同的实例
```

### TRANSIENT 示例

```typescript
// 请求处理器应该是瞬时
container.addTransient("RequestHandler", RequestHandlerService);

const handler1 = await container.get<RequestHandlerService>("RequestHandler");
const handler2 = await container.get<RequestHandlerService>("RequestHandler");

console.log(handler1 === handler2); // false - 每次都是新实例
```

---

## 依赖注入的三种方式

### 方式1：手动注入（简单场景）

```typescript
class DatabaseService implements IService {
  private logger?: LogService;

  setLogger(logger: LogService): void {
    this.logger = logger;
  }
}

// 注册服务
container.addSingleton("LogService", LogService);
container.addSingleton("DatabaseService", DatabaseService);

// 获取服务
const logger = await container.get<LogService>("LogService");
const db = await container.get<DatabaseService>("DatabaseService");

// 手动注入依赖
db.setLogger(logger);
```

**优点**：简单直接
**缺点**：需要手动管理依赖顺序

---

### 方式2：工厂函数注入（推荐 ⭐）

```typescript
class DatabaseService implements IService {
  private logger?: LogService;

  setLogger(logger: LogService): void {
    this.logger = logger;
  }
}

// 使用工厂函数注册，自动解析依赖
container.addFactory(
  "DatabaseService",
  async (container: ServiceContainer) => {
    // 从容器获取依赖
    const logger = await container.get<LogService>("LogService");

    // 创建服务并注入依赖
    const db = new DatabaseService();
    db.setLogger(logger);

    // 手动初始化
    await db.initialize();

    return db;
  }
);

// 直接使用，依赖自动注入
const db = await container.get<DatabaseService>("DatabaseService");
```

**优点**：依赖自动解析，代码清晰
**缺点**：需要写工厂函数
**推荐指数**：⭐⭐⭐⭐⭐

---

### 方式3：容器引用（最灵活 🚀）

```typescript
class UserService implements IService {
  readonly serviceName = "UserService";
  private container: ServiceContainer;
  private logger?: LogService;
  private db?: DatabaseService;

  // 【关键】构造函数接收容器
  constructor(config: { container: ServiceContainer }) {
    this.container = config.container;
  }

  async initialize(): Promise<void> {
    // 【关键】从容器获取所有依赖
    this.logger = await this.container.get<LogService>("LogService");
    this.db = await this.container.get<DatabaseService>("DatabaseService");
  }

  async getUser(id: number): Promise<any> {
    this.logger?.log(`获取用户 ${id}`);
    return this.db?.query(`SELECT * FROM users WHERE id = ${id}`);
  }
}

// 注册时传递容器引用
container.addFactory(
  "UserService",
  async (container: ServiceContainer) => {
    const service = new UserService({ container });
    await service.initialize();
    return service;
  }
);
```

**优点**：最灵活，可动态获取服务
**缺点**：服务类需要依赖容器
**推荐指数**：⭐⭐⭐⭐ （复杂场景）

---

## 实际应用场景

### 场景1：多用户系统

```typescript
// 创建全局容器，注册共享服务
const globalContainer = new ServiceContainer("global");
globalContainer.addSingleton("ConfigService", ConfigService);
globalContainer.addSingleton("LogService", LogService);

// 为每个用户创建独立的作用域容器
function createUserContainer(userId: string): ServiceContainer {
  const userContainer = globalContainer.createScope(`user:${userId}`);

  // 注册用户级别的服务
  userContainer.addScoped("UserSessionService", UserSessionService, {
    config: { userId }
  });

  return userContainer;
}

// 使用
const alice = createUserContainer("alice");
const bob = createUserContainer("bob");

// 每个用户有独立的会话，但共享配置和日志服务
```

### 场景2：可配置的服务

```typescript
// 注册服务时传递配置
container.addSingleton("DatabaseService", DatabaseService, {
  enabled: true,
  config: {
    host: "localhost",
    port: 5432,
    database: "myapp",
    maxConnections: 10
  }
});

// 服务构造函数接收配置
class DatabaseService implements IService {
  constructor(config: DatabaseConfig) {
    this.config = config;
  }
}
```

### 场景3：服务替换（测试）

```typescript
// 生产环境
container.addSingleton("EmailService", RealEmailService);

// 测试环境
container.addSingleton("EmailService", MockEmailService);

// 业务代码不需要修改
const emailService = await container.get<IEmailService>("EmailService");
await emailService.sendEmail("test@example.com", "Hello");
```

---

## 运行示例

### 快速上手示例

```bash
npx ts-node examples/ServiceContainerQuickStart.ts
```

展示三种依赖注入方式的最简单示例（约 5 分钟）

### 完整功能示例

```bash
npx ts-node examples/ServiceContainerExample.ts
```

包含 6 个详细示例：

1. 基础使用 - 手动注入依赖
2. 工厂函数 - 自动解析依赖
3. 作用域服务 - 多用户场景
4. 瞬时服务 - 每次请求新实例
5. 服务内部获取其他服务（核心）
6. 容器调试和状态检查

---

## 常见问题

### Q1: 如何在一个 Service 中获取另一个 Service？

**答**: 有三种方法，推荐方法 2 或 3：

```typescript
// 方法1：通过 setter 注入（简单）
class ServiceB {
  private serviceA?: ServiceA;

  setServiceA(serviceA: ServiceA) {
    this.serviceA = serviceA;
  }
}

// 方法2：通过工厂函数注入（推荐）
container.addFactory("ServiceB", async (container) => {
  const serviceA = await container.get<ServiceA>("ServiceA");
  const serviceB = new ServiceB();
  serviceB.setServiceA(serviceA);
  return serviceB;
});

// 方法3：通过容器引用（最灵活）
class ServiceB {
  constructor(private container: ServiceContainer) {}

  async initialize() {
    const serviceA = await this.container.get<ServiceA>("ServiceA");
  }
}
```

### Q2: ServiceRegistration.ts 是示例文件吗？

**答**: **不是！** `ServiceRegistration.ts` 是**核心系统文件**，负责注册项目中的所有内置服务（如 `ImportanceEvaluatorService`、`MemoryCompressorService` 等）。

**不要删除它！**

示例文件位于：

- [ServiceContainerQuickStart.ts](./ServiceContainerQuickStart.ts) - 快速上手
- [ServiceContainerExample.ts](./ServiceContainerExample.ts) - 完整示例

### Q3: 什么时候使用 SINGLETON/SCOPED/TRANSIENT？

| 场景 | 生命周期 | 原因 |
|-----|---------|------|
| 配置服务 | SINGLETON | 配置在应用启动时加载，全局共享 |
| 日志服务 | SINGLETON | 日志输出应该统一管理 |
| 数据库连接池 | SINGLETON | 连接池需要全局共享，避免重复创建 |
| 用户会话 | SCOPED | 每个用户有独立的会话数据 |
| HTTP 请求上下文 | SCOPED | 每个请求有独立的上下文 |
| 请求处理器 | TRANSIENT | 每个请求独立处理，避免状态污染 |
| 临时计算任务 | TRANSIENT | 短期任务，用完即销毁 |

### Q4: 服务的 initialize 和 dispose 是必需的吗？

**答**: **可选的**。但强烈建议实现：

- `initialize()` - 在这里执行：
  - 连接数据库
  - 加载配置
  - 初始化资源

- `dispose()` - 在这里执行：
  - 关闭数据库连接
  - 清理缓存
  - 释放文件句柄

容器会自动调用这些方法，确保资源正确管理。

### Q5: 如何调试容器中的服务？

**答**: 使用内置的调试方法：

```typescript
// 检查服务是否已注册
console.log(container.has("MyService"));

// 列出所有已注册的服务
console.log(container.getServiceNames());

// 打印容器详细信息
container.debug();

// 安全获取服务（不抛异常）
const service = await container.tryGet<MyService>("MyService");
if (!service) {
  console.log("服务不存在或已禁用");
}
```

### Q6: 如何禁用某个服务？

**答**: 在注册时设置 `enabled: false`：

```typescript
container.addSingleton("OptionalService", OptionalService, {
  enabled: false  // 禁用服务
});

// 尝试获取会抛出 "服务 OptionalService 已禁用" 错误
```

### Q7: 容器支持循环依赖吗？

**答**: **不支持**。如果服务 A 依赖 B，B 又依赖 A，会导致无限循环。

**解决方案**：

1. 重新设计依赖关系，避免循环
2. 使用事件总线解耦
3. 引入中间服务打破循环

### Q8: 如何在现有项目中集成 ServiceContainer？

**答**: 分步骤迁移：

```typescript
// 步骤1: 创建全局容器
import { globalContainer, registerCoreServices } from "./Core";

// 步骤2: 注册核心服务
registerCoreServices(globalContainer);

// 步骤3: 逐步迁移现有服务
// 旧代码（直接实例化）
const memoryService = new MemoryService(config);

// 新代码（从容器获取）
const memoryService = await globalContainer.get<MemoryService>("MemoryService");

// 步骤4: 在应用启动时初始化
async function bootstrap() {
  registerCoreServices(globalContainer);
  // ... 其他初始化代码
}

// 步骤5: 在应用关闭时释放资源
async function shutdown() {
  await globalContainer.dispose();
}
```

---

## 更多资源

- **源码文件**:
  - [IService.ts](../src/Core/IService.ts) - 服务接口定义
  - [ServiceContainer.ts](../src/Core/ServiceContainer.ts) - 容器实现
  - [ServiceRegistration.ts](../src/Core/ServiceRegistration.ts) - 核心服务注册

- **示例文件**:
  - [ServiceContainerQuickStart.ts](./ServiceContainerQuickStart.ts) - 快速上手
  - [ServiceContainerExample.ts](./ServiceContainerExample.ts) - 完整示例

- **实际应用**:
  - [ImportanceEvaluatorService.ts](../src/Memory/Services/ImportanceEvaluatorService.ts)
  - [MemoryCompressorService.ts](../src/Memory/Services/MemoryCompressorService.ts)

---

## 总结

✅ **ServiceContainer 帮助你**：

- 解耦代码，提高可维护性
- 统一管理服务生命周期
- 简化依赖注入
- 方便单元测试

✅ **推荐使用方式**：

- 单例服务：配置、日志、数据库连接池
- 作用域服务：用户会话、请求上下文
- 瞬时服务：临时任务处理器

✅ **依赖注入推荐**：

- 简单场景：手动注入
- 一般场景：工厂函数（推荐）
- 复杂场景：容器引用

---

**开始使用**:

```bash
# 快速上手（3 分钟）
npx ts-node examples/ServiceContainerQuickStart.ts

# 完整示例（10 分钟）
npx ts-node examples/ServiceContainerExample.ts
```

祝你使用愉快！🎉
