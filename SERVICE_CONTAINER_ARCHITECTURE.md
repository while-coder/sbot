# SBot 服务容器架构

## 📋 概述

SBot 使用 **依赖注入（DI）容器** 来管理服务的生命周期和依赖关系。

---

## 🏗️ 核心概念

### 1. 服务（IService）

所有服务都实现 `IService` 接口：

```typescript
interface IService {
  readonly serviceName: string;
  initialize?(): Promise<void>;
  dispose?(): Promise<void>;
  isInitialized?: boolean;
}
```

### 2. 生命周期

三种服务生命周期：

| 生命周期 | 说明 | 适用场景 |
|---------|------|---------|
| **SINGLETON** | 全局单例 | 配置服务、数据库连接池 |
| **SCOPED** | 每个作用域一个 | 用户会话、请求上下文 |
| **TRANSIENT** | 每次创建新的 | 临时工具类、计算服务 |

### 3. 服务容器（ServiceContainer）

管理服务的注册、解析和生命周期：

```typescript
const container = new ServiceContainer("app");

// 注册服务
container.addSingleton("ConfigService", ConfigService);
container.addScoped("UserService", UserService);
container.addTransient("HelperService", HelperService);

// 获取服务
const service = await container.get<ConfigService>("ConfigService");

// 创建作用域
const userScope = container.createScope("user-123");

// 释放资源
await container.dispose();
```

---

## 🚀 快速开始

### 1. 创建服务

```typescript
import { IService } from "./Core/IService";

export class MyService implements IService {
  readonly serviceName = "MyService";
  isInitialized = false;

  constructor(private config: any) {}

  async initialize(): Promise<void> {
    // 初始化逻辑
    this.isInitialized = true;
  }

  async dispose(): Promise<void> {
    // 清理资源
  }

  async doSomething(): Promise<void> {
    // 业务逻辑
  }
}
```

### 2. 注册服务

```typescript
import { ServiceContainer } from "./Core";

const container = new ServiceContainer("app");

container.addSingleton("MyService", MyService, {
  enabled: true,
  config: { apiKey: "xxx" }
});
```

### 3. 使用服务

```typescript
// 获取服务
const myService = await container.get<MyService>("MyService");
await myService.doSomething();

// 检查是否存在
if (container.has("MyService")) {
  const service = await container.get<MyService>("MyService");
}

// 尝试获取（不抛异常）
const maybe = await container.tryGet<MyService>("MyService");
```

---

## 🎯 实际应用

### 示例1：记忆服务

```typescript
export class MemoryService implements IService {
  readonly serviceName = "MemoryService";
  isInitialized = false;

  private db: MemoryDatabase;
  private embeddings: Embeddings;

  constructor(config: MemoryServiceConfig) {
    this.db = new MemoryDatabase(config.dbPath);
    this.embeddings = new OpenAIEmbeddings(config.embeddingConfig);
  }

  async initialize(): Promise<void> {
    // 初始化数据库连接
    this.isInitialized = true;
  }

  async dispose(): Promise<void> {
    // 关闭数据库连接
  }

  async addMemory(content: string): Promise<string> {
    // 添加记忆
  }
}
```

### 示例2：带依赖的服务

```typescript
export class AnalyticsService implements IService {
  readonly serviceName = "AnalyticsService";

  private memoryService?: MemoryService;
  private container: ServiceContainer;

  constructor(container: ServiceContainer) {
    this.container = container;
  }

  async initialize(): Promise<void> {
    // 获取依赖的服务
    this.memoryService = await this.container.tryGet<MemoryService>("MemoryService");
  }

  async analyze(): Promise<void> {
    if (this.memoryService) {
      // 使用记忆服务
      const stats = await this.memoryService.getStatistics();
    }
  }
}
```

### 示例3：作用域服务（用户会话）

```typescript
const rootContainer = new ServiceContainer("root");

// 注册全局服务
rootContainer.addSingleton("DatabaseService", DatabaseService);

// 为每个用户创建作用域
function handleUserLogin(userId: string) {
  const userScope = rootContainer.createScope(`user-${userId}`);

  // 注册用户级服务
  userScope.addScoped("UserCacheService", UserCacheService);

  // 使用服务
  const cache = await userScope.get<UserCacheService>("UserCacheService");

  // 用户登出时释放
  await userScope.dispose();
}
```

---

## 💡 扩展：实现钩子机制

如果需要类似"插件"的钩子功能，可以通过接口实现：

### 1. 定义钩子接口

```typescript
export interface IQueryInterceptor {
  onBeforeQuery?(query: string, context: any): Promise<string>;
  onAfterResponse?(response: string, query: string, context: any): Promise<string>;
}
```

### 2. 服务实现钩子

```typescript
export class MemoryService implements IService, IQueryInterceptor {
  readonly serviceName = "MemoryService";

  async onBeforeQuery(query: string, context: any): Promise<string> {
    // 检索相关记忆并注入上下文
    const memories = await this.retrieveRelevantMemories(query);

    if (memories.length > 0) {
      const memoryContext = memories.map(m => m.content).join("\n");
      return `相关记忆：\n${memoryContext}\n\n用户查询：${query}`;
    }

    return query;
  }

  async onAfterResponse(response: string, query: string, context: any): Promise<string> {
    // 记忆对话
    await this.addMemory(query);
    await this.addMemory(response);
    return response;
  }
}
```

### 3. 在 AgentService 中调用钩子

```typescript
export class AgentService {
  private container: ServiceContainer;

  constructor(container: ServiceContainer) {
    this.container = container;
  }

  async processQuery(query: string): Promise<string> {
    // 获取所有实现了 IQueryInterceptor 的服务
    const interceptors = await this.getInterceptors();

    // onBeforeQuery 钩子
    let processedQuery = query;
    for (const interceptor of interceptors) {
      if (interceptor.onBeforeQuery) {
        processedQuery = await interceptor.onBeforeQuery(processedQuery, {});
      }
    }

    // 处理查询
    const response = await this.handleQuery(processedQuery);

    // onAfterResponse 钩子
    let processedResponse = response;
    for (const interceptor of interceptors) {
      if (interceptor.onAfterResponse) {
        processedResponse = await interceptor.onAfterResponse(
          processedResponse,
          query,
          {}
        );
      }
    }

    return processedResponse;
  }

  private async getInterceptors(): Promise<IQueryInterceptor[]> {
    const interceptors: IQueryInterceptor[] = [];

    // 获取所有服务
    const serviceNames = this.container.getServiceNames();

    for (const name of serviceNames) {
      const service = await this.container.tryGet(name);

      // 检查是否实现了 IQueryInterceptor
      if (service && this.isQueryInterceptor(service)) {
        interceptors.push(service as IQueryInterceptor);
      }
    }

    return interceptors;
  }

  private isQueryInterceptor(obj: any): obj is IQueryInterceptor {
    return typeof obj.onBeforeQuery === 'function' ||
           typeof obj.onAfterResponse === 'function';
  }
}
```

---

## 📚 API 参考

### ServiceContainer

```typescript
// 注册服务
addSingleton<T>(name: string, implementation: new (...args: any[]) => T, config?: ServiceConfiguration): void
addScoped<T>(name: string, implementation: new (...args: any[]) => T, config?: ServiceConfiguration): void
addTransient<T>(name: string, implementation: new (...args: any[]) => T, config?: ServiceConfiguration): void
addFactory<T>(name: string, factory: (container: ServiceContainer) => T | Promise<T>, lifetime: ServiceLifetime): void

// 获取服务
get<T>(name: string): Promise<T>
tryGet<T>(name: string): Promise<T | null>
has(name: string): boolean

// 作用域管理
createScope(scopeId: string): ServiceContainer
dispose(): Promise<void>

// 调试
debug(): void
getServiceNames(): string[]
```

---

## 🎨 架构优势

| 特性 | 传统方式 | 服务容器 |
|------|---------|---------|
| **依赖管理** | 手动创建 | 自动注入 ✅ |
| **生命周期** | 手动管理 | 自动管理 ✅ |
| **配置** | 分散 | 集中 ✅ |
| **测试** | 难以 mock | 易于替换 ✅ |
| **作用域** | 难以实现 | 原生支持 ✅ |

---

## ⚠️ 最佳实践

1. **服务命名**：使用后缀 `Service`（如 `MemoryService`）
2. **生命周期选择**：
   - 配置、日志、数据库连接 → SINGLETON
   - 用户会话、请求上下文 → SCOPED
   - 临时工具、计算服务 → TRANSIENT
3. **依赖获取**：在 `initialize()` 中获取，不在构造函数中
4. **错误处理**：使用 `tryGet()` 处理可选依赖
5. **资源清理**：实现 `dispose()` 方法清理资源

---

## 📖 相关文档

- [src/Core/IService.ts](src/Core/IService.ts) - 服务接口定义
- [src/Core/ServiceContainer.ts](src/Core/ServiceContainer.ts) - 容器实现
- [src/Core/ServiceRegistration.ts](src/Core/ServiceRegistration.ts) - 服务注册
- [SERVICE_CONTAINER_QUICK_REF.md](SERVICE_CONTAINER_QUICK_REF.md) - 快速参考
- [SERVICE_CONTAINER_GUIDE.md](SERVICE_CONTAINER_GUIDE.md) - 详细指南

---

**使用服务容器，让代码更模块化、更易维护！** 🚀
