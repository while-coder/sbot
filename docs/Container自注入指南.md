# Container 自注入指南

## 概述

Container 支持将自己作为依赖注入到服务的构造函数中。这是一个强大的特性，允许服务在运行时动态解析其他依赖，实现更灵活的架构模式。

## 基本用法

```typescript
import { singleton, inject, Container } from "./Core";

@singleton()
class MyService {
  constructor(
    @inject(Container) private container: Container
  ) {}

  async getSomeService(): Promise<SomeService> {
    // 延迟解析依赖
    return await this.container.resolve(SomeService);
  }
}
```

## 使用场景

### 1. 延迟解析（Lazy Resolution）

**问题：** 某些依赖可能很重，或者只在特定条件下需要。

**解决方案：** 注入 Container，只在需要时解析依赖。

```typescript
@singleton()
class ReportGenerator {
  constructor(
    @inject(Container) private container: Container
  ) {}

  async generateReport(type: "pdf" | "excel"): Promise<Report> {
    if (type === "pdf") {
      const pdfService = await this.container.resolve(PDFService);
      return pdfService.generate();
    } else {
      const excelService = await this.container.resolve(ExcelService);
      return excelService.generate();
    }
  }
}
```

**优势：**
- 只加载需要的服务
- 减少初始化时间
- 降低内存占用

### 2. 打破循环依赖

**问题：** A 依赖 B，B 依赖 A，形成循环依赖。

**解决方案：** 其中一个服务注入 Container，延迟解析另一个服务。

```typescript
// 场景：UserService 和 AuthService 相互依赖

@singleton()
class UserService {
  constructor(
    @inject(Container) private container: Container
  ) {}

  async authenticate(userId: string): Promise<boolean> {
    // 延迟解析 AuthService，避免循环依赖
    const authService = await this.container.resolve(AuthService);
    return authService.verify(userId);
  }
}

@singleton()
class AuthService {
  constructor(
    private userService: UserService  // 直接注入
  ) {}

  async verify(userId: string): Promise<boolean> {
    // 使用 userService
    return true;
  }
}
```

### 3. 动态服务工厂

**问题：** 需要根据配置或运行时条件选择不同的服务实现。

**解决方案：** 创建工厂类，注入 Container，动态解析服务。

```typescript
@singleton()
class StorageFactory {
  constructor(
    @inject(Container) private container: Container,
    @inject("STORAGE_TYPE") private storageType: string
  ) {}

  async getStorage(): Promise<IStorage> {
    switch (this.storageType) {
      case "s3":
        return await this.container.resolve(S3Storage);
      case "local":
        return await this.container.resolve(LocalStorage);
      case "azure":
        return await this.container.resolve(AzureStorage);
      default:
        throw new Error(`不支持的存储类型: ${this.storageType}`);
    }
  }
}
```

### 4. 插件系统

**问题：** 插件需要向容器注册自己的服务，或访问容器中的服务。

**解决方案：** 插件管理器注入 Container，提供给插件使用。

```typescript
interface Plugin {
  name: string;
  init(container: Container): Promise<void>;
}

@singleton()
class PluginManager {
  private plugins: Plugin[] = [];

  constructor(
    @inject(Container) private container: Container
  ) {}

  registerPlugin(plugin: Plugin): void {
    this.plugins.push(plugin);
  }

  async initializePlugins(): Promise<void> {
    for (const plugin of this.plugins) {
      // 传递容器给插件
      await plugin.init(this.container);
    }
  }
}

// 插件实现
class CachePlugin implements Plugin {
  name = "CachePlugin";

  async init(container: Container): Promise<void> {
    // 插件可以向容器注册服务
    container.registerSingleton(CacheService);
    container.registerInstance("CACHE_TTL", 3600);
  }
}
```

### 5. 请求作用域（Scoped Services）

**问题：** 需要为每个 HTTP 请求创建独立的服务实例。

**解决方案：** 使用父容器创建子容器，隔离请求作用域。

```typescript
@singleton()
class RequestScopeManager {
  constructor(
    @inject(Container) private parentContainer: Container
  ) {}

  createRequestScope(requestId: string): Container {
    const requestContainer = new Container();

    // 请求特定的数据
    requestContainer.registerInstance("REQUEST_ID", requestId);
    requestContainer.registerInstance("REQUEST_TIME", Date.now());

    // 可以从父容器解析全局单例
    // 但瞬时服务在请求容器中是独立的

    return requestContainer;
  }
}

// 使用示例
async function handleRequest(req: Request) {
  const scopeManager = await globalContainer.resolve(RequestScopeManager);
  const requestContainer = scopeManager.createRequestScope(req.id);

  // 在请求容器中解析服务
  const userService = await requestContainer.resolve(UserService);
  const response = await userService.handleRequest();

  return response;
}
```

### 6. 条件注册（Conditional Registration）

**问题：** 根据环境或配置决定注册哪些服务。

**解决方案：** 在初始化服务中注入 Container，动态注册服务。

```typescript
@singleton()
class ApplicationBootstrap {
  constructor(
    @inject(Container) private container: Container,
    @inject("NODE_ENV") private env: string
  ) {}

  async bootstrap(): Promise<void> {
    // 根据环境注册不同的服务
    if (this.env === "production") {
      this.container.registerSingleton(ProductionLogger);
      this.container.registerSingleton(RedisCache);
    } else {
      this.container.registerSingleton(ConsoleLogger);
      this.container.registerSingleton(InMemoryCache);
    }

    // 注册通用服务
    this.container.registerSingleton(DatabaseService);
    this.container.registerSingleton(ApiService);
  }
}
```

## 最佳实践

### ✅ 推荐做法

1. **优先使用构造函数注入具体依赖**
   ```typescript
   // 好：明确的依赖关系
   constructor(private userService: UserService) {}

   // 不推荐：除非有特殊需求
   constructor(@inject(Container) private container: Container) {}
   ```

2. **仅在必要时注入 Container**
   - 延迟解析
   - 打破循环依赖
   - 动态服务选择
   - 插件系统

3. **缓存解析结果**
   ```typescript
   @singleton()
   class MyService {
     private cachedService?: SomeService;

     constructor(@inject(Container) private container: Container) {}

     async getService(): Promise<SomeService> {
       if (!this.cachedService) {
         this.cachedService = await this.container.resolve(SomeService);
       }
       return this.cachedService;
     }
   }
   ```

4. **使用工厂模式封装复杂逻辑**
   ```typescript
   // 好：封装在工厂中
   @singleton()
   class ServiceFactory {
     constructor(@inject(Container) private container: Container) {}
     async create(type: string) { /* ... */ }
   }

   // 服务使用工厂
   @singleton()
   class MyService {
     constructor(private factory: ServiceFactory) {}
   }
   ```

### ❌ 避免的做法

1. **不要滥用 Container 注入**
   ```typescript
   // 不好：应该直接注入依赖
   @singleton()
   class BadService {
     constructor(@inject(Container) private container: Container) {}

     async doSomething() {
       const db = await this.container.resolve(DatabaseService);
       const cache = await this.container.resolve(CacheService);
       const logger = await this.container.resolve(LoggerService);
       // 这些依赖应该在构造函数中直接注入
     }
   }

   // 好：明确的依赖关系
   @singleton()
   class GoodService {
     constructor(
       private db: DatabaseService,
       private cache: CacheService,
       private logger: LoggerService
     ) {}
   }
   ```

2. **不要在 resolve 过程中修改容器**
   ```typescript
   // 危险：可能导致不可预测的行为
   @singleton()
   class DangerousService {
     constructor(@inject(Container) private container: Container) {
       // ❌ 不要在构造函数中注册服务
       this.container.registerInstance("SOME_VALUE", 123);
     }
   }
   ```

3. **避免过深的嵌套解析**
   ```typescript
   // 不好：多层嵌套解析，难以理解和维护
   const service1 = await container.resolve(Service1);
   const service2 = await service1.getService2();
   const service3 = await service2.getService3();
   ```

## 实现原理

Container 在解析构造函数参数时，会检查令牌是否为 `Container` 类本身：

```typescript
// Container.ts 中的实现
private async constructInstance<T>(target: Constructor<T>): Promise<T> {
  // ...
  for (let i = 0; i < paramTypes.length; i++) {
    const token = injectTokens.get(i) ?? paramTypes[i];

    // 特殊处理：如果注入的是 Container 本身
    if (token === Container) {
      args.push(this);  // 返回当前容器实例
    } else {
      args.push(await this.resolve(token));
    }
  }

  return new target(...args);
}
```

## 类型安全

TypeScript 完全支持 Container 自注入的类型推断：

```typescript
@singleton()
class TypeSafeService {
  constructor(
    @inject(Container) private container: Container  // ✅ 类型安全
  ) {}

  async getTypedService<T>(ServiceClass: new (...args: any[]) => T): Promise<T> {
    // ✅ 返回类型正确推断
    return await this.container.resolve(ServiceClass);
  }
}
```

## 性能考虑

1. **解析开销**：每次调用 `container.resolve()` 都有一定开销
2. **缓存策略**：对于频繁使用的服务，应该缓存解析结果
3. **单例 vs 瞬时**：单例服务只解析一次，瞬时服务每次都创建新实例

```typescript
// 性能优化示例
@singleton()
class OptimizedService {
  private readonly serviceCache = new Map<string, any>();

  constructor(@inject(Container) private container: Container) {}

  async getService<T>(key: string, ServiceClass: any): Promise<T> {
    if (!this.serviceCache.has(key)) {
      const service = await this.container.resolve(ServiceClass);
      this.serviceCache.set(key, service);
    }
    return this.serviceCache.get(key) as T;
  }
}
```

## 总结

Container 自注入是一个强大但需要谨慎使用的特性：

- ✅ **适用场景明确**：延迟解析、循环依赖、动态工厂、插件系统
- ✅ **保持简洁**：优先使用构造函数直接注入依赖
- ✅ **性能优化**：缓存频繁使用的服务
- ✅ **类型安全**：利用 TypeScript 的类型系统
- ❌ **避免滥用**：不要替代正常的依赖注入
- ❌ **避免副作用**：不要在解析过程中修改容器

正确使用 Container 自注入可以让您的应用架构更加灵活，同时保持代码的清晰和可维护性。
