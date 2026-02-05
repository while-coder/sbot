
# 服务容器架构指南

## 概述

服务容器（ServiceContainer）是一个轻量级的依赖注入（DI）框架，灵感来自 .NET 的 ServiceCollection/ServiceProvider。它提供：

- ✅ **依赖注入**：自动管理服务依赖关系
- ✅ **生命周期管理**：支持单例、作用域、瞬时三种生命周期
- ✅ **模块化设计**：服务独立、易于测试和替换
- ✅ **资源管理**：自动初始化和释放服务资源

---

## 核心概念

### 1. 服务（IService）

所有可挂载的服务都实现 `IService` 接口：

```typescript
interface IService {
  serviceName: string;          // 服务唯一标识
  initialize?(): Promise<void>; // 初始化
  dispose?(): Promise<void>;    // 释放资源
  isInitialized?: boolean;      // 是否已初始化
}
```

### 2. 生命周期（ServiceLifetime）

三种服务生命周期：

| 生命周期 | 说明 | 适用场景 |
|---------|------|---------|
| **SINGLETON** | 全局单例，整个应用只创建一次 | 配置服务、全局状态 |
| **SCOPED** | 作用域单例，每个作用域创建一次 | 用户会话、请求上下文 |
| **TRANSIENT** | 瞬时，每次请求都创建新实例 | 轻量级工具类 |

### 3. 服务容器（ServiceContainer）

管理服务注册、解析和生命周期的容器：

```typescript
const container = new ServiceContainer("app");

// 注册服务
container.addSingleton("MyService", MyServiceImpl);
container.addScoped("UserService", UserServiceImpl);
container.addTransient("HelperService", HelperImpl);

// 获取服务
const service = await container.get<MyService>("MyService");

// 创建作用域
const userScope = container.createScope("user-123");

// 释放资源
await container.dispose();
```

---

## 快速开始

### 1. 创建服务

```typescript
import { IService } from "./Core/IService";

export class MyService implements IService {
  readonly serviceName = "MyService";
  isInitialized = false;

  private config: any;

  constructor(config: any) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    // 初始化逻辑
    console.log("MyService 初始化完成");
    this.isInitialized = true;
  }

  async dispose(): Promise<void> {
    // 清理资源
    console.log("MyService 已释放");
  }

  // 服务方法
  async doSomething(): Promise<void> {
    // ...
  }
}
```

### 2. 注册服务

```typescript
import { ServiceContainer } from "./Core";

const container = new ServiceContainer("app");

// 方式1：注册单例
container.addSingleton("MyService", MyService, {
  enabled: true,
  config: { apiKey: "xxx" }
});

// 方式2：使用工厂函数
container.addFactory(
  "MyService",
  (container) => {
    const config = { /* ... */ };
    return new MyService(config);
  },
  ServiceLifetime.SINGLETON
);
```

### 3. 使用服务

```typescript
// 获取服务
const myService = await container.get<MyService>("MyService");
await myService.doSomething();

// 检查服务是否存在
if (container.has("MyService")) {
  const service = await container.get<MyService>("MyService");
}

// 尝试获取（不抛出异常）
const maybeService = await container.tryGet<MyService>("MyService");
if (maybeService) {
  // 使用服务
}
```

---

## 高级用法

### 1. 作用域容器

用于管理用户会话、请求上下文等作用域服务：

```typescript
const rootContainer = new ServiceContainer("root");

// 注册全局单例
rootContainer.addSingleton("GlobalConfig", ConfigService);

// 为每个用户创建作用域
function handleUserSession(userId: string) {
  const userScope = rootContainer.createScope(`user-${userId}`);

  // 注册用户级服务（只在这个用户的作用域内有效）
  userScope.addScoped("UserCache", UserCacheService);

  // 使用服务
  const cache = await userScope.get<UserCacheService>("UserCache");

  // 用户会话结束时释放作用域
  await userScope.dispose();
}
```

### 2. 服务依赖

服务可以依赖其他服务：

```typescript
export class UserService implements IService {
  readonly serviceName = "UserService";

  private cacheService: CacheService;
  private logService: LogService;

  constructor(config: any, container: ServiceContainer) {
    // 在构造函数或 initialize 中获取依赖
  }

  async initialize(): Promise<void> {
    // 从容器获取依赖服务
    this.cacheService = await container.get<CacheService>("CacheService");
    this.logService = await container.get<LogService>("LogService");
  }
}
```

### 3. 条件注册

根据配置启用/禁用服务：

```typescript
container.addSingleton("FeatureService", FeatureService, {
  enabled: config.features.enableNewFeature,
  config: { /* ... */ }
});

// 获取时会检查 enabled 状态
try {
  const service = await container.get("FeatureService");
} catch (error) {
  // 服务已禁用
}
```

### 4. 调试容器

```typescript
// 打印容器信息
container.debug();

// 输出：
// === 服务容器: app ===
// 已注册服务 (3):
//   ✓ MyService (singleton)
//   ✓ UserService (scoped)
//   ✗ DisabledService (singleton)
// 单例实例 (1):
//   • MyService
// 作用域实例 (0):
```

---

## 实际应用示例

### 示例1：记忆服务架构

```typescript
// 1. 注册核心服务
const container = new ServiceContainer("app");

container.addSingleton(
  "ImportanceEvaluatorService",
  ImportanceEvaluatorService,
  {
    enabled: true,
    config: {
      apiKey: "your-api-key",
      model: "gpt-3.5-turbo"
    }
  }
);

container.addSingleton(
  "MemoryCompressorService",
  MemoryCompressorService,
  {
    enabled: true,
    config: {
      apiKey: "your-api-key",
      model: "gpt-3.5-turbo"
    }
  }
);

// 2. 在 MemoryService 中使用
export class MemoryService {
  private container: ServiceContainer;

  constructor(userId: string, container: ServiceContainer) {
    this.container = container;
  }

  async evaluateImportance(content: string) {
    // 从容器获取服务
    const evaluator = await this.container.tryGet<ImportanceEvaluatorService>(
      "ImportanceEvaluatorService"
    );

    if (evaluator && evaluator.isEnabled()) {
      return await evaluator.evaluate(content);
    }

    // 使用默认方法
    return this.heuristicEvaluation(content);
  }
}
```

### 示例2：用户会话管理

```typescript
const rootContainer = new ServiceContainer("root");

// 注册全局服务
rootContainer.addSingleton("DatabaseService", DatabaseService);
rootContainer.addSingleton("ConfigService", ConfigService);

// 用户登录时创建作用域
class UserSessionManager {
  private userScopes = new Map<string, ServiceContainer>();

  async createUserSession(userId: string) {
    const userScope = rootContainer.createScope(`user-${userId}`);

    // 注册用户级服务
    userScope.addScoped("UserCacheService", UserCacheService);
    userScope.addScoped("UserPreferenceService", UserPreferenceService);

    this.userScopes.set(userId, userScope);
    return userScope;
  }

  async endUserSession(userId: string) {
    const userScope = this.userScopes.get(userId);
    if (userScope) {
      await userScope.dispose();
      this.userScopes.delete(userId);
    }
  }
}
```

---

## 与现有代码集成

### 迁移步骤

#### 1. 将现有类改造为服务

**Before:**
```typescript
export class MyClass {
  constructor(config: any) {
    // ...
  }
}
```

**After:**
```typescript
import { IService } from "./Core/IService";

export class MyService implements IService {
  readonly serviceName = "MyService";
  isInitialized = false;

  constructor(config: any) {
    // ...
  }

  async initialize(): Promise<void> {
    // 初始化逻辑
    this.isInitialized = true;
  }

  async dispose(): Promise<void> {
    // 清理逻辑
  }
}
```

#### 2. 注册服务

```typescript
import { globalContainer } from "./Core";

// 应用程序启动时注册
globalContainer.addSingleton("MyService", MyService, {
  config: { /* ... */ }
});
```

#### 3. 使用服务

**Before:**
```typescript
const myClass = new MyClass(config);
```

**After:**
```typescript
const myService = await container.get<MyService>("MyService");
```

---

## 最佳实践

### 1. 服务命名

使用清晰的命名约定：

```typescript
// ✅ 好的命名
"ImportanceEvaluatorService"
"MemoryCompressorService"
"UserAuthenticationService"

// ❌ 不好的命名
"Service1"
"Helper"
"Utils"
```

### 2. 生命周期选择

| 场景 | 推荐生命周期 |
|------|------------|
| 配置、日志、数据库连接 | SINGLETON |
| 用户会话、请求上下文 | SCOPED |
| 临时计算、工具类 | TRANSIENT |

### 3. 依赖管理

```typescript
// ✅ 推荐：在 initialize 中获取依赖
async initialize(): Promise<void> {
  this.dependency = await this.container.get("DependencyService");
}

// ❌ 避免：在构造函数中进行异步操作
constructor() {
  // 不要在这里调用 async 方法
}
```

### 4. 错误处理

```typescript
// ✅ 使用 tryGet 避免异常
const service = await container.tryGet("OptionalService");
if (service) {
  await service.doSomething();
}

// ✅ 检查服务是否存在
if (container.has("RequiredService")) {
  const service = await container.get("RequiredService");
}
```

### 5. 资源释放

```typescript
// ✅ 确保释放资源
try {
  const scope = container.createScope("temp");
  // 使用服务
} finally {
  await scope.dispose();
}

// ✅ 应用程序关闭时释放根容器
process.on('SIGTERM', async () => {
  await rootContainer.dispose();
  process.exit(0);
});
```

---

## 对比：传统方式 vs 服务容器

### 传统方式

```typescript
// 紧耦合，难以测试
export class MemoryService {
  private evaluator: ImportanceEvaluator;
  private compressor: MemoryCompressor;

  constructor(config: any) {
    // 直接实例化依赖
    this.evaluator = new ImportanceEvaluator(config);
    this.compressor = new MemoryCompressor(config);
  }
}

// 使用时需要手动管理配置和依赖
const memoryService = new MemoryService({
  apiKey: "xxx",
  // 所有依赖的配置都要传入
});
```

### 服务容器方式

```typescript
// 松耦合，易于测试
export class MemoryService {
  private container: ServiceContainer;

  constructor(container: ServiceContainer) {
    this.container = container;
  }

  async initialize() {
    // 从容器获取依赖（自动管理生命周期）
    this.evaluator = await this.container.tryGet("ImportanceEvaluatorService");
    this.compressor = await this.container.tryGet("MemoryCompressorService");
  }
}

// 使用时只需从容器获取
const memoryService = await container.get<MemoryService>("MemoryService");
```

**优势：**
- ✅ 依赖自动注入
- ✅ 易于替换实现（测试时可以注入 Mock）
- ✅ 统一的生命周期管理
- ✅ 配置集中管理

---

## 常见问题

### Q1: 服务容器会增加性能开销吗？

A: 开销很小。服务创建后会被缓存（单例/作用域），后续获取几乎无开销。

### Q2: 如何处理循环依赖？

A: 避免循环依赖，通过重构将共同依赖提取到独立服务。

### Q3: 可以在运行时动态注册服务吗？

A: 可以，但不推荐。建议在应用启动时完成所有注册。

### Q4: 如何mock服务进行测试？

A: 创建测试容器，注册mock实现：

```typescript
const testContainer = new ServiceContainer("test");
testContainer.addSingleton("MyService", MockMyService);
```

---

## 示例代码

完整示例请查看：
- [service-container-example.ts](examples/service-container-example.ts)

## 相关文件

- [src/Core/IService.ts](src/Core/IService.ts) - 服务接口定义
- [src/Core/ServiceContainer.ts](src/Core/ServiceContainer.ts) - 容器实现
- [src/Core/ServiceRegistration.ts](src/Core/ServiceRegistration.ts) - 服务注册
- [src/Memory/Services/](src/Memory/Services/) - 记忆服务实现

---

**使用服务容器，让代码更模块化、更易维护！** 🚀
