# 服务容器快速参考

## 🚀 5分钟上手

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

  // 你的业务方法
  async doSomething() {
    // ...
  }
}
```

### 2. 注册服务

```typescript
import { ServiceContainer } from "./Core";

const container = new ServiceContainer("app");

container.addSingleton("MyService", MyService, {
  config: { apiKey: "xxx" }
});
```

### 3. 使用服务

```typescript
const service = await container.get<MyService>("MyService");
await service.doSomething();
```

---

## 📚 常用API

### 注册服务

```typescript
// 单例（全局唯一）
container.addSingleton("ServiceName", ServiceClass, { config });

// 作用域（每个作用域一个）
container.addScoped("ServiceName", ServiceClass, { config });

// 瞬时（每次创建新的）
container.addTransient("ServiceName", ServiceClass, { config });

// 工厂函数
container.addFactory("ServiceName", (container) => {
  return new ServiceClass(/* ... */);
});
```

### 获取服务

```typescript
// 获取（不存在抛异常）
const service = await container.get<MyService>("MyService");

// 尝试获取（不存在返回null）
const maybe = await container.tryGet<MyService>("MyService");

// 检查是否存在
if (container.has("MyService")) {
  // ...
}
```

### 作用域管理

```typescript
// 创建作用域
const scope = container.createScope("user-123");

// 使用作用域
const service = await scope.get("ScopedService");

// 释放作用域
await scope.dispose();
```

---

## 🎯 生命周期选择

| 使用场景 | 生命周期 |
|---------|---------|
| 配置服务、日志 | SINGLETON |
| 数据库连接池 | SINGLETON |
| 用户会话 | SCOPED |
| 请求上下文 | SCOPED |
| 临时计算 | TRANSIENT |
| 工具类 | TRANSIENT |

---

## 💡 常见模式

### 模式1：服务依赖其他服务

```typescript
export class UserService implements IService {
  private cache: CacheService;
  private log: LogService;

  constructor(private container: ServiceContainer) {}

  async initialize() {
    // 从容器获取依赖
    this.cache = await this.container.get("CacheService");
    this.log = await this.container.get("LogService");
  }
}
```

### 模式2：可选依赖

```typescript
async initialize() {
  // 可选功能
  this.optional = await this.container.tryGet("OptionalService");

  if (this.optional) {
    // 使用可选功能
  }
}
```

### 模式3：条件启用

```typescript
container.addSingleton("FeatureService", FeatureService, {
  enabled: config.features.enableNewFeature,
  config: { /* ... */ }
});
```

---

## 🔧 调试技巧

```typescript
// 查看容器信息
container.debug();

// 列出所有服务
const services = container.getServiceNames();
console.log("已注册服务:", services);

// 检查服务状态
if (container.has("MyService")) {
  console.log("MyService 已注册");
}
```

---

## ⚠️ 注意事项

1. **不要在构造函数中进行异步操作**
   ```typescript
   // ❌ 错误
   constructor() {
     this.init(); // async 方法
   }

   // ✅ 正确
   async initialize() {
     await this.init();
   }
   ```

2. **及时释放作用域**
   ```typescript
   // ❌ 可能导致内存泄漏
   const scope = container.createScope("temp");
   await scope.get("Service");
   // 忘记释放

   // ✅ 正确
   try {
     const scope = container.createScope("temp");
     await scope.get("Service");
   } finally {
     await scope.dispose();
   }
   ```

3. **避免循环依赖**
   ```typescript
   // ❌ A 依赖 B，B 依赖 A
   // 重构：提取共同依赖到独立服务
   ```

---

## 📖 完整文档

- [SERVICE_CONTAINER_GUIDE.md](SERVICE_CONTAINER_GUIDE.md) - 详细指南
- [SERVICE_CONTAINER_SUMMARY.md](SERVICE_CONTAINER_SUMMARY.md) - 实现总结
- [examples/service-container-example.ts](examples/service-container-example.ts) - 示例代码

---

**快速开始，立即使用！** 🚀
