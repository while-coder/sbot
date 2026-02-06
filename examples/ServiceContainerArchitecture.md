# ServiceContainer 架构图解

## 📊 服务容器架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        Application                               │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                  ServiceContainer (Root)                    │ │
│  │  ┌──────────────────────────────────────────────────────┐  │ │
│  │  │            Service Descriptors Registry              │  │ │
│  │  │  - ServiceA (Singleton)                              │  │ │
│  │  │  - ServiceB (Singleton)                              │  │ │
│  │  │  - ServiceC (Scoped)                                 │  │ │
│  │  │  - ServiceD (Transient)                              │  │ │
│  │  └──────────────────────────────────────────────────────┘  │ │
│  │                                                              │ │
│  │  ┌──────────────────────────────────────────────────────┐  │ │
│  │  │         Singleton Instances Cache                    │  │ │
│  │  │  [ServiceA Instance] ──────────> (Shared Globally)   │  │ │
│  │  │  [ServiceB Instance] ──────────> (Shared Globally)   │  │ │
│  │  └──────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                           │                                       │
│       ┌───────────────────┼───────────────────┐                 │
│       │                   │                   │                 │
│  ┌────▼────┐        ┌────▼────┐        ┌────▼────┐            │
│  │ Scope 1 │        │ Scope 2 │        │ Scope 3 │            │
│  │ (User1) │        │ (User2) │        │ (User3) │            │
│  │         │        │         │        │         │            │
│  │ [C-Inst]│        │ [C-Inst]│        │ [C-Inst]│            │
│  └─────────┘        └─────────┘        └─────────┘            │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔄 服务生命周期对比

### Singleton（单例）

```
Application Lifetime
├─ ServiceContainer.get("SingletonService")  ──> [Instance A]
├─ ServiceContainer.get("SingletonService")  ──> [Instance A] (Same)
├─ ServiceContainer.get("SingletonService")  ──> [Instance A] (Same)
└─ Application Shutdown
   └─ dispose() ──> [Instance A] destroyed
```

### Scoped（作用域）

```
Application Lifetime
│
├─ Scope 1 (User: Alice)
│  ├─ get("ScopedService") ──> [Instance A1]
│  ├─ get("ScopedService") ──> [Instance A1] (Same in scope)
│  └─ Scope 1 dispose()    ──> [Instance A1] destroyed
│
├─ Scope 2 (User: Bob)
│  ├─ get("ScopedService") ──> [Instance A2] (Different!)
│  ├─ get("ScopedService") ──> [Instance A2] (Same in scope)
│  └─ Scope 2 dispose()    ──> [Instance A2] destroyed
│
└─ Application Shutdown
```

### Transient（瞬时）

```
Application Lifetime
├─ get("TransientService") ──> [Instance 1] (New)
├─ get("TransientService") ──> [Instance 2] (New)
├─ get("TransientService") ──> [Instance 3] (New)
└─ Application Shutdown
```

---

## 🔗 服务依赖注入的三种方式

### 方式1: 手动注入

```
┌──────────────┐
│  Container   │
└──────┬───────┘
       │
       │ 1. get("ServiceA")
       ├────────────────────> [ServiceA Instance]
       │
       │ 2. get("ServiceB")
       ├────────────────────> [ServiceB Instance]
       │
       │ 3. Manual Injection
       │
       └────> serviceB.setServiceA(serviceA)
                     │
                     └────> [ServiceB now has ServiceA]

User Responsibility:
  - Get services manually
  - Inject dependencies manually
  - Manage order of operations
```

### 方式2: 工厂函数（推荐）

```
┌──────────────┐
│  Container   │
└──────┬───────┘
       │
       │ get("ServiceB")
       │
       ├────> Execute Factory Function
       │      │
       │      ├─ 1. get("ServiceA")     ──> [ServiceA Instance]
       │      │
       │      ├─ 2. new ServiceB()      ──> [ServiceB Instance]
       │      │
       │      ├─ 3. serviceB.setServiceA(serviceA)
       │      │
       │      └─ 4. return serviceB
       │
       └────> [ServiceB with ServiceA injected]

Container Responsibility:
  - Execute factory
  - Resolve dependencies
  - Inject automatically
```

### 方式3: 容器引用（最灵活）

```
┌──────────────┐
│  Container   │──────┐
└──────┬───────┘      │
       │              │ Container Reference
       │ get("ServiceB")
       │              │
       ├────> Factory │
       │      │       │
       │      └─> new ServiceB({ container })
       │              │
       │              │
       └────> [ServiceB Instance]
                  │
                  │ Holds Container Reference
                  │
                  ├─ initialize()
                  │  └─> this.container.get("ServiceA")
                  │  └─> this.container.get("ServiceC")
                  │
                  ├─ doWork()
                  │  └─> this.container.get("AnyService")
                  │
                  └─> Can get any service at runtime!

Service Responsibility:
  - Store container reference
  - Get dependencies in initialize()
  - Can dynamically get services
```

---

## 📦 项目中的实际服务依赖关系

### 当前架构（直接实例化）

```
┌─────────────────────────────────────────────────────────────┐
│                      Application                             │
└─────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴──────────┐
                    │                    │
            ┌───────▼───────┐    ┌──────▼─────┐
            │  LarkService  │    │   Config   │
            │  (Singleton)  │    │ (Singleton)│
            └───────┬───────┘    └──────┬─────┘
                    │                   │
            ┌───────▼──────────┐        │
            │ LarkUserService  │        │
            │  (per user)      │        │
            └───────┬──────────┘        │
                    │                   │
                    │ creates           │ provides config
            ┌───────▼──────────┐        │
            │  AgentService    │◀───────┘
            │  (per request)   │
            └───────┬──────────┘
                    │ creates
            ┌───────▼──────────┐
            │  MemoryService   │
            │  (per user)      │
            └───────┬──────────┘
                    │ uses
        ┌───────────┴──────────────┐
        │                           │
┌───────▼────────────┐  ┌──────────▼──────────┐
│ImportanceEvaluator │  │ MemoryCompressor    │
│   (per user)       │  │   (per user)        │
└────────────────────┘  └─────────────────────┘

问题:
  ❌ 服务之间紧耦合（直接 new）
  ❌ 难以替换实现（测试困难）
  ❌ 生命周期管理混乱
  ❌ 配置传递复杂
```

### 使用 ServiceContainer 后（推荐架构）

```
┌─────────────────────────────────────────────────────────────┐
│                 ServiceContainer (Global)                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Singleton Services                                   │   │
│  │  - ConfigService                                      │   │
│  │  - LogService                                         │   │
│  │  - DatabaseConnectionPool                             │   │
│  │  - ImportanceEvaluatorService                         │   │
│  │  - MemoryCompressorService                            │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────┬────────────────────────────────────┘
                       │
         ┌─────────────┼─────────────┐
         │             │             │
    ┌────▼────┐   ┌───▼─────┐  ┌───▼─────┐
    │ Scope 1 │   │ Scope 2 │  │ Scope 3 │
    │ (Alice) │   │  (Bob)  │  │ (Carol) │
    └────┬────┘   └───┬─────┘  └───┬─────┘
         │            │            │
         │ Scoped Services         │
         │ - UserSessionService    │
         │ - MemoryService         │
         │ - AgentService          │
         └────────────┴────────────┘

优点:
  ✅ 服务解耦（通过容器管理）
  ✅ 易于测试（可替换实现）
  ✅ 生命周期清晰
  ✅ 配置统一管理
```

---

## 🎯 示例：完整的服务依赖链

### 场景：用户查询数据

```
┌─────────────────────────────────────────────────────────────┐
│                       User Request                           │
│                 "查询用户ID=123的信息"                         │
└─────────────────────┬───────────────────────────────────────┘
                      │
              ┌───────▼────────┐
              │ UserController │
              │  (Entry Point) │
              └───────┬────────┘
                      │ get("UserBusinessService")
              ┌───────▼─────────────────────┐
              │  ServiceContainer           │
              │  ┌─────────────────────┐    │
              │  │ UserBusinessService │◀───┤
              │  └─────────┬───────────┘    │
              │            │ needs:         │
              │            │ - LogService   │
              │            │ - DbService    │
              │  ┌─────────▼───────────┐    │
              │  │ Factory resolves:   │    │
              │  │ 1. get(LogService)  │    │
              │  │ 2. get(DbService)   │    │
              │  │ 3. new UserBusiness │    │
              │  │ 4. inject deps      │    │
              │  └─────────┬───────────┘    │
              └────────────┼────────────────┘
                           │
                  ┌────────┴─────────┐
                  │                  │
          ┌───────▼───────┐  ┌──────▼──────┐
          │  LogService   │  │  DbService  │
          │  (Singleton)  │  │ (Singleton) │
          └───────┬───────┘  └──────┬──────┘
                  │                 │
                  └────────┬────────┘
                           │
                  ┌────────▼─────────┐
                  │ UserBusinessService
                  │ .getUser(123)     │
                  └────────┬──────────┘
                           │
                  ┌────────▼──────────┐
                  │ 1. log("查询...")  │
                  │ 2. db.query(...)  │
                  │ 3. return user    │
                  └───────────────────┘
```

---

## 🧪 测试场景：服务替换

### 生产环境

```
┌──────────────────────┐
│  ServiceContainer    │
│  (Production)        │
└──────────┬───────────┘
           │
           ├─> EmailService ──> RealEmailService
           │                    (Sends real emails)
           │
           ├─> DatabaseService ──> PostgresService
           │                       (Real database)
           │
           └─> PaymentService ──> StripePaymentService
                                  (Real payments)
```

### 测试环境

```
┌──────────────────────┐
│  ServiceContainer    │
│  (Testing)           │
└──────────┬───────────┘
           │
           ├─> EmailService ──> MockEmailService
           │                    (Logs to console)
           │
           ├─> DatabaseService ──> InMemoryDbService
           │                       (Uses Map)
           │
           └─> PaymentService ──> FakePaymentService
                                  (Always succeeds)

业务代码无需修改：
  const emailService = await container.get<IEmailService>("EmailService");
  await emailService.send(...); // 自动使用 Mock/Real
```

---

## 🔐 安全性和资源管理

### 生命周期管理

```
Application Start
      │
      ├─> container.addSingleton("DbPool", DatabasePool)
      │   └─> Initialize connection pool
      │
      ├─> const scope1 = container.createScope("user1")
      │   └─> scope1.addScoped("Session", UserSession)
      │       └─> Initialize user session
      │
      ├─> Application Running...
      │   ├─> Requests using services
      │   └─> Services sharing resources
      │
      ├─> scope1.dispose()
      │   └─> UserSession.dispose()
      │       └─> Clean session data
      │       └─> Release session resources
      │
      └─> Application Shutdown
          └─> container.dispose()
              └─> DatabasePool.dispose()
                  └─> Close all connections
                  └─> Release database resources

自动管理：
  ✅ 初始化顺序（依赖先初始化）
  ✅ 资源清理（自动调用 dispose）
  ✅ 作用域隔离（用户数据不混乱）
```

---

## 📋 ServiceRegistration.ts 的角色

```
┌────────────────────────────────────────────────────────┐
│                Application Bootstrap                    │
└────────────────────┬───────────────────────────────────┘
                     │
         ┌───────────▼───────────┐
         │ registerCoreServices  │ ◀─── ServiceRegistration.ts
         │  (globalContainer)    │
         └───────────┬───────────┘
                     │
     ┌───────────────┼──────────────────┐
     │               │                  │
     ▼               ▼                  ▼
┌─────────┐  ┌──────────────┐  ┌──────────────┐
│ Config  │  │ ImportanceEv │  │ MemoryCompr  │
│ Service │  │ aluatorServ  │  │ essorService │
└─────────┘  └──────────────┘  └──────────────┘
     │               │                  │
     └───────────────┼──────────────────┘
                     │
             ┌───────▼────────┐
             │ All services   │
             │ registered and │
             │ ready to use   │
             └────────────────┘

角色：
  ✅ 统一注册入口
  ✅ 读取配置并传递给服务
  ✅ 控制服务启用/禁用
  ✅ 管理服务依赖关系
```

---

## 🎓 学习路径可视化

```
┌─────────────────────────────────────────────────────────┐
│                    Learning Path                         │
└─────────────────────────────────────────────────────────┘

Level 1: Basics (30 min)
  ├─> 理解 IService 接口
  ├─> 理解服务注册
  ├─> 理解服务获取
  └─> 运行 ServiceContainerQuickStart.ts

Level 2: Intermediate (1 hour)
  ├─> 理解三种生命周期
  ├─> 理解三种依赖注入方式
  ├─> 理解作用域容器
  └─> 运行 ServiceContainerExample.ts

Level 3: Advanced (2 hours)
  ├─> 阅读 ServiceContainer.ts 源码
  ├─> 研究 ServiceRegistration.ts
  ├─> 分析现有服务实现
  └─> 在项目中应用

Level 4: Expert
  ├─> 设计复杂服务架构
  ├─> 优化服务性能
  ├─> 实现自定义容器功能
  └─> 贡献改进建议
```

---

## 💡 关键设计模式

### 1. 依赖注入模式（Dependency Injection）

```
传统方式:
  class ServiceA {
    constructor() {
      this.serviceB = new ServiceB(); // 紧耦合
    }
  }

DI 方式:
  class ServiceA {
    constructor(serviceB: ServiceB) { // 松耦合
      this.serviceB = serviceB;
    }
  }
```

### 2. 工厂模式（Factory Pattern）

```
container.addFactory("ServiceA", (container) => {
  // 工厂负责创建复杂对象
  const deps = resolveDependencies();
  return new ServiceA(deps);
});
```

### 3. 单例模式（Singleton Pattern）

```
container.addSingleton("ConfigService", ConfigService);
// 容器保证全局只有一个实例
```

### 4. 作用域模式（Scoped Pattern）

```
const userScope = container.createScope("user:123");
// 每个作用域有独立的服务实例
```

---

## 🚀 性能优化提示

### 延迟加载

```
// ✅ 推荐：按需加载
container.addFactory("HeavyService", async (container) => {
  // 只在首次调用 get() 时才创建
  return new HeavyService();
});

// ❌ 避免：立即创建
const heavy = new HeavyService(); // 应用启动时就创建
```

### 作用域管理

```
// ✅ 推荐：用完释放
const userScope = container.createScope("user");
await doWork(userScope);
await userScope.dispose(); // 释放资源

// ❌ 避免：忘记释放
const userScope = container.createScope("user");
await doWork(userScope);
// 内存泄漏！
```

### 缓存策略

```
// Singleton: 永久缓存
container.addSingleton("ConfigService", ...);

// Scoped: 作用域内缓存
container.addScoped("UserSession", ...);

// Transient: 不缓存
container.addTransient("TempCalculator", ...);
```

---

## 📊 对比其他 DI 框架

| 特性 | ServiceContainer | NestJS | InversifyJS | .NET Core |
|-----|------------------|--------|-------------|-----------|
| 类型安全 | ✅ TypeScript | ✅ TypeScript | ✅ TypeScript | ✅ C# |
| 装饰器 | ❌ 不需要 | ✅ @Injectable | ✅ @injectable | ✅ [Service] |
| 生命周期 | 3种 | 3种 | 3种 | 3种 |
| 作用域 | ✅ 支持 | ✅ 支持 | ✅ 支持 | ✅ 支持 |
| 学习曲线 | ⭐⭐ 简单 | ⭐⭐⭐⭐ 复杂 | ⭐⭐⭐ 中等 | ⭐⭐⭐ 中等 |
| 灵活性 | ⭐⭐⭐⭐ 高 | ⭐⭐⭐ 中 | ⭐⭐⭐⭐ 高 | ⭐⭐⭐⭐ 高 |

---

## 🎉 总结

ServiceContainer 提供了一个**简单而强大**的依赖注入解决方案：

✅ **简单易用** - 无需装饰器，API 清晰
✅ **灵活强大** - 三种生命周期，三种注入方式
✅ **类型安全** - 完整的 TypeScript 支持
✅ **易于测试** - 轻松替换服务实现
✅ **资源管理** - 自动初始化和清理

立即开始：

```bash
npx ts-node examples/ServiceContainerQuickStart.ts
```
