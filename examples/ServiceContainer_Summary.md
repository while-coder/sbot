# ServiceContainer 完整文档总结

## 📦 已创建的文件

| 文件 | 类型 | 说明 |
|-----|------|------|
| [ServiceContainerQuickStart.ts](./ServiceContainerQuickStart.ts) | 示例代码 | 快速上手，3种依赖注入方式（5分钟） |
| [ServiceContainerExample.ts](./ServiceContainerExample.ts) | 示例代码 | 完整示例，6个详细场景（15分钟） |
| [README_ServiceContainer.md](./README_ServiceContainer.md) | 文档 | 使用指南，包含常见问题解答 |
| [ServiceContainer_Summary.md](./ServiceContainer_Summary.md) | 文档 | 本文档，总结概览 |

---

## 🎯 关于 ServiceRegistration.ts

### ❌ 不应该删除！

[ServiceRegistration.ts](../src/Core/ServiceRegistration.ts) **不是示例文件**，而是**核心系统文件**。

它的作用：

1. ✅ **注册核心服务** - 为整个应用注册 `ImportanceEvaluatorService`、`MemoryCompressorService` 等内置服务
2. ✅ **统一配置入口** - 从 `config` 中读取配置，统一初始化服务
3. ✅ **生产环境使用** - 在应用启动时被调用

### 文件内容：

```typescript
export function registerCoreServices(container: ServiceContainer): void {
  const modelConfig = config.getCurrentModel();
  const memoryConfig = config.settings.memory;

  // 注册重要性评估服务（单例）
  container.addSingleton("ImportanceEvaluatorService", ImportanceEvaluatorService, {
    enabled: memoryConfig?.enabled !== false,
    config: { apiKey: modelConfig.apiKey, baseURL: modelConfig.baseURL, model: "gpt-3.5-turbo" }
  });

  // 注册记忆压缩服务（单例）
  container.addSingleton("MemoryCompressorService", MemoryCompressorService, {
    enabled: memoryConfig?.enabled !== false,
    config: { apiKey: modelConfig.apiKey, baseURL: modelConfig.baseURL, model: "gpt-3.5-turbo" }
  });
}

export function createUserServiceContainer(rootContainer: ServiceContainer, userId: string): ServiceContainer {
  return rootContainer.createScope(`user:${userId}`);
}
```

### 在项目中的使用：

```typescript
// 应用启动时
import { globalContainer, registerCoreServices } from "./Core";

async function bootstrap() {
  // 注册所有核心服务
  registerCoreServices(globalContainer);

  // 获取服务使用
  const evaluator = await globalContainer.get<ImportanceEvaluatorService>("ImportanceEvaluatorService");
}
```

---

## 🚀 核心问题解答

### 1️⃣ 如何在一个 Service 里获取另一个同 ServiceContainer 的 Service？

有 **三种方式**：

#### 方式 1: 手动注入（简单场景）

```typescript
class ServiceB implements IService {
  private serviceA?: ServiceA;

  setServiceA(serviceA: ServiceA): void {
    this.serviceA = serviceA;
  }

  useServiceA(): void {
    this.serviceA?.doSomething();
  }
}

// 使用
const serviceA = await container.get<ServiceA>("ServiceA");
const serviceB = await container.get<ServiceB>("ServiceB");
serviceB.setServiceA(serviceA); // 手动注入
```

**优点**: 简单直接
**缺点**: 需要手动管理依赖

---

#### 方式 2: 工厂函数注入（推荐 ⭐⭐⭐⭐⭐）

```typescript
class ServiceB implements IService {
  private serviceA?: ServiceA;

  setServiceA(serviceA: ServiceA): void {
    this.serviceA = serviceA;
  }
}

// 注册时使用工厂函数
container.addFactory(
  "ServiceB",
  async (container: ServiceContainer) => {
    // 从容器获取依赖
    const serviceA = await container.get<ServiceA>("ServiceA");

    // 创建服务并注入依赖
    const serviceB = new ServiceB();
    serviceB.setServiceA(serviceA);

    // 初始化
    await serviceB.initialize();

    return serviceB;
  }
);

// 使用（依赖自动注入）
const serviceB = await container.get<ServiceB>("ServiceB");
```

**优点**: 依赖自动解析，清晰易懂
**缺点**: 需要写工厂函数
**推荐指数**: ⭐⭐⭐⭐⭐

---

#### 方式 3: 容器引用（最灵活 🚀）

```typescript
class ServiceB implements IService {
  readonly serviceName = "ServiceB";
  private container: ServiceContainer;
  private serviceA?: ServiceA;

  // 【关键】构造函数接收容器引用
  constructor(config: { container: ServiceContainer }) {
    this.container = config.container;
  }

  async initialize(): Promise<void> {
    // 【关键】在初始化时从容器获取其他服务
    this.serviceA = await this.container.get<ServiceA>("ServiceA");
  }

  // 【关键】也可以在运行时动态获取
  async doSomethingComplex(): Promise<void> {
    // 运行时动态获取其他服务
    const serviceC = await this.container.get<ServiceC>("ServiceC");
    serviceC.process();
  }
}

// 注册时传递容器引用
container.addFactory(
  "ServiceB",
  async (container: ServiceContainer) => {
    const service = new ServiceB({ container });
    await service.initialize();
    return service;
  }
);
```

**优点**: 最灵活，可动态获取任意服务
**缺点**: 服务类依赖容器
**推荐指数**: ⭐⭐⭐⭐ （复杂场景）

---

### 2️⃣ 完整的可执行示例

参见 [ServiceContainerQuickStart.ts](./ServiceContainerQuickStart.ts) 的示例 3：

```bash
npx ts-node examples/ServiceContainerQuickStart.ts
```

输出示例：

```
========== 方式3: 服务内部获取其他服务（最灵活）==========

✅ LoggerService 已初始化
[LOG] DatabaseService 正在初始化...
✅ DatabaseService 已初始化
[LOG] AdvancedUserService 正在初始化...
✅ AdvancedUserService 已初始化
[LOG] 获取用户 1 及其文章
[LOG] 执行 SQL: SELECT * FROM users WHERE id = 1
[LOG] 执行 SQL: SELECT * FROM posts WHERE user_id = 1

用户及其文章: { id: 1, name: '测试数据', posts: [...] }
[LOG] 动态获取的服务也可以使用！
```

---

## 📚 Core/Service 模块完整结构

### 核心文件

| 文件 | 说明 | 作用 |
|-----|------|------|
| [IService.ts](../src/Core/IService.ts) | 服务接口定义 | 定义所有服务必须实现的接口 |
| [ServiceContainer.ts](../src/Core/ServiceContainer.ts) | 容器实现 | 依赖注入容器，管理服务生命周期 |
| [ServiceRegistration.ts](../src/Core/ServiceRegistration.ts) | 核心服务注册 | 注册项目内置服务（**不要删除**） |
| [index.ts](../src/Core/index.ts) | 模块导出 | 统一导出 Core 模块的所有功能 |

### 服务实现示例

| 文件 | 服务名 | 生命周期 | 说明 |
|-----|--------|---------|------|
| [ImportanceEvaluatorService.ts](../src/Memory/Services/ImportanceEvaluatorService.ts) | ImportanceEvaluatorService | SINGLETON | 记忆重要性评估服务 |
| [MemoryCompressorService.ts](../src/Memory/Services/MemoryCompressorService.ts) | MemoryCompressorService | SINGLETON | 记忆压缩服务 |

---

## 🔧 运行示例

### 快速上手（3分钟）

```bash
npx ts-node examples/ServiceContainerQuickStart.ts
```

包含：

- ✅ 方式1：手动注入依赖
- ✅ 方式2：工厂函数自动注入（推荐）
- ✅ 方式3：服务内部获取其他服务（最灵活）

### 完整示例（15分钟）

```bash
npx ts-node examples/ServiceContainerExample.ts
```

包含 6 个详细示例：

1. 基础使用 - 手动注入依赖
2. 工厂函数 - 自动解析依赖
3. 作用域服务 - 多用户场景
4. 瞬时服务 - 每次请求新实例
5. **服务内部获取其他服务（核心）**
6. 容器调试和状态检查

---

## 📖 学习路径

### 新手入门

1. ✅ 阅读 [README_ServiceContainer.md](./README_ServiceContainer.md) 的"快速开始"部分
2. ✅ 运行 `npx ts-node examples/ServiceContainerQuickStart.ts`
3. ✅ 理解三种依赖注入方式的区别
4. ✅ 选择一种方式在自己的项目中试用

### 进阶学习

1. ✅ 运行 `npx ts-node examples/ServiceContainerExample.ts`
2. ✅ 研究示例 5（服务内部获取其他服务）
3. ✅ 理解服务生命周期（SINGLETON/SCOPED/TRANSIENT）
4. ✅ 学习作用域容器的使用（多用户场景）

### 深入理解

1. ✅ 阅读源码 [ServiceContainer.ts](../src/Core/ServiceContainer.ts)
2. ✅ 研究现有服务实现 [ImportanceEvaluatorService.ts](../src/Memory/Services/ImportanceEvaluatorService.ts)
3. ✅ 理解 [ServiceRegistration.ts](../src/Core/ServiceRegistration.ts) 如何注册核心服务
4. ✅ 在实际项目中应用

---

## 💡 最佳实践

### ✅ 推荐做法

```typescript
// 1. 使用工厂函数注册服务（推荐）
container.addFactory("ServiceName", async (container) => {
  const dep = await container.get<DepService>("DepService");
  const service = new ServiceName();
  service.setDep(dep);
  await service.initialize();
  return service;
});

// 2. 为服务实现 initialize 和 dispose
class MyService implements IService {
  async initialize(): Promise<void> {
    // 连接数据库、加载配置等
  }

  async dispose(): Promise<void> {
    // 关闭连接、清理资源等
  }
}

// 3. 使用合适的生命周期
container.addSingleton("ConfigService", ConfigService);    // 全局共享
container.addScoped("UserSessionService", UserSessionService);  // 用户级别
container.addTransient("RequestHandler", RequestHandler);  // 每次新建

// 4. 应用关闭时释放资源
async function shutdown() {
  await container.dispose();
}
```

### ❌ 避免的做法

```typescript
// 1. 避免直接 new 服务（除非在工厂函数中）
const service = new MyService(); // ❌ 不推荐
const service = await container.get<MyService>("MyService"); // ✅ 推荐

// 2. 避免循环依赖
class ServiceA {
  constructor(private serviceB: ServiceB) {} // ❌ A 依赖 B
}
class ServiceB {
  constructor(private serviceA: ServiceA) {} // ❌ B 依赖 A
}

// 3. 避免在服务中保存大量状态（SINGLETON 服务）
class MyService {
  private cache = new Map(); // ⚠️ 注意内存泄漏
}

// 4. 避免忘记释放资源
// ❌ 应用关闭时没有调用 dispose
// ✅ 应该在应用关闭时调用
await container.dispose();
```

---

## 🎉 总结

### 关键点

1. ✅ **ServiceRegistration.ts 不要删除** - 它是核心系统文件
2. ✅ **推荐使用工厂函数** - 方式2最实用
3. ✅ **容器引用最灵活** - 方式3适合复杂场景
4. ✅ **选择合适的生命周期** - SINGLETON/SCOPED/TRANSIENT
5. ✅ **记得释放资源** - 调用 `dispose()`

### 在服务中获取其他服务的最佳方式

```typescript
// 【推荐】工厂函数 + 初始化时注入
class MyService implements IService {
  private container: ServiceContainer;
  private otherService?: OtherService;

  constructor(config: { container: ServiceContainer }) {
    this.container = config.container;
  }

  async initialize(): Promise<void> {
    // 从容器获取依赖
    this.otherService = await this.container.get<OtherService>("OtherService");
  }

  doWork(): void {
    this.otherService?.doSomething();
  }
}

// 注册
container.addFactory("MyService", async (container) => {
  const service = new MyService({ container });
  await service.initialize();
  return service;
});
```

---

## 📞 帮助资源

- **示例代码**: [ServiceContainerQuickStart.ts](./ServiceContainerQuickStart.ts)
- **详细文档**: [README_ServiceContainer.md](./README_ServiceContainer.md)
- **源码阅读**: [ServiceContainer.ts](../src/Core/ServiceContainer.ts)
- **实际应用**: [ServiceRegistration.ts](../src/Core/ServiceRegistration.ts)

---

**祝你使用愉快！** 🎉

有问题欢迎查阅文档或运行示例代码。
