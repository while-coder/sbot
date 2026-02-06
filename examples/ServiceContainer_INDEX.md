# 📖 ServiceContainer 完整文档索引

欢迎！这是 ServiceContainer（依赖注入容器）的完整文档和示例集合。

---

## 🚀 快速开始（5分钟）

想要快速上手？按照这个顺序：

1. **运行快速示例**
   ```bash
   npx ts-node examples/ServiceContainerQuickStart.ts
   ```

2. **阅读概览**
   - [ServiceContainer_Summary.md](./ServiceContainer_Summary.md) - 核心问题解答

3. **选择依赖注入方式**
   - 简单场景：方式1（手动注入）
   - 一般场景：方式2（工厂函数）⭐ 推荐
   - 复杂场景：方式3（容器引用）

---

## 📚 文档列表

| 文档 | 类型 | 阅读时间 | 说明 |
|-----|------|---------|------|
| [ServiceContainer_Summary.md](./ServiceContainer_Summary.md) | 总结 | 5分钟 | **必读**，核心问题解答，快速参考 |
| [README_ServiceContainer.md](./README_ServiceContainer.md) | 教程 | 15分钟 | 完整使用指南，包含常见问题 |
| [ServiceContainerArchitecture.md](./ServiceContainerArchitecture.md) | 架构图 | 10分钟 | 可视化架构图解和流程图 |
| [ServiceContainer_INDEX.md](./ServiceContainer_INDEX.md) | 索引 | 3分钟 | 本文档，资源导航 |

---

## 💻 示例代码

| 文件 | 难度 | 运行时间 | 说明 |
|-----|------|---------|------|
| [ServiceContainerQuickStart.ts](./ServiceContainerQuickStart.ts) | ⭐ 入门 | 3分钟 | 三种依赖注入方式的最简示例 |
| [ServiceContainerExample.ts](./ServiceContainerExample.ts) | ⭐⭐⭐ 进阶 | 15分钟 | 完整示例集合（6个场景） |

### 运行示例

```bash
# 快速上手
npx ts-node examples/ServiceContainerQuickStart.ts

# 完整示例
npx ts-node examples/ServiceContainerExample.ts
```

---

## 🔍 核心源码

| 文件 | 行数 | 说明 |
|-----|------|------|
| [IService.ts](../src/Core/IService.ts) | ~87 行 | 服务接口定义 |
| [ServiceContainer.ts](../src/Core/ServiceContainer.ts) | ~363 行 | 容器核心实现 |
| [ServiceRegistration.ts](../src/Core/ServiceRegistration.ts) | ~69 行 | 核心服务注册（**不要删除**） |
| [index.ts](../src/Core/index.ts) | ~10 行 | 模块导出 |

---

## 🎯 按场景查找

### 我想了解基础概念

1. 阅读 [README_ServiceContainer.md](./README_ServiceContainer.md) 的"核心概念"部分
2. 理解 IService 接口
3. 理解三种生命周期（SINGLETON/SCOPED/TRANSIENT）

**推荐文档**: [README_ServiceContainer.md](./README_ServiceContainer.md) - 核心概念章节

---

### 我想知道如何在服务中获取其他服务

这是最常见的问题！有**三种方式**：

| 方式 | 推荐指数 | 适用场景 |
|-----|---------|---------|
| 方式1：手动注入 | ⭐⭐ | 简单场景，服务很少 |
| 方式2：工厂函数 | ⭐⭐⭐⭐⭐ | 一般场景，**最推荐** |
| 方式3：容器引用 | ⭐⭐⭐⭐ | 复杂场景，需要动态获取 |

**推荐阅读**:
- [ServiceContainer_Summary.md](./ServiceContainer_Summary.md) - 问题1
- [ServiceContainerQuickStart.ts](./ServiceContainerQuickStart.ts) - 示例3

**推荐运行**:
```bash
npx ts-node examples/ServiceContainerQuickStart.ts
```

---

### 我想了解 ServiceRegistration.ts 是什么

**重要**: `ServiceRegistration.ts` **不是示例文件，不要删除！**

它是**核心系统文件**，负责：
- ✅ 注册项目内置服务
- ✅ 配置服务依赖关系
- ✅ 统一服务初始化入口

**推荐阅读**:
- [ServiceContainer_Summary.md](./ServiceContainer_Summary.md) - "关于 ServiceRegistration.ts"
- [ServiceRegistration.ts](../src/Core/ServiceRegistration.ts) - 源码

---

### 我想看架构图和流程图

**推荐阅读**: [ServiceContainerArchitecture.md](./ServiceContainerArchitecture.md)

包含：
- 服务容器架构总览
- 服务生命周期对比图
- 三种依赖注入方式流程图
- 项目实际服务依赖关系
- 测试场景服务替换图

---

### 我想在项目中使用

1. **快速集成**

```typescript
import { globalContainer, registerCoreServices } from "./Core";

// 应用启动时
async function bootstrap() {
  registerCoreServices(globalContainer);
  // 其他初始化...
}

// 使用服务
const service = await globalContainer.get<MyService>("MyService");

// 应用关闭时
async function shutdown() {
  await globalContainer.dispose();
}
```

2. **注册自己的服务**

```typescript
// 使用工厂函数（推荐）
globalContainer.addFactory(
  "MyService",
  async (container: ServiceContainer) => {
    const dep = await container.get<DepService>("DepService");
    const service = new MyService();
    service.setDep(dep);
    await service.initialize();
    return service;
  }
);
```

**推荐阅读**:
- [README_ServiceContainer.md](./README_ServiceContainer.md) - Q8: 如何在现有项目中集成

---

### 我想理解生命周期

| 生命周期 | 说明 | 示例 |
|---------|------|------|
| SINGLETON | 全局唯一，应用启动时创建 | 配置服务、日志服务 |
| SCOPED | 每个作用域一个实例 | 用户会话、请求上下文 |
| TRANSIENT | 每次获取都创建新实例 | 临时计算器、请求处理器 |

**推荐阅读**:
- [README_ServiceContainer.md](./README_ServiceContainer.md) - "服务生命周期"
- [ServiceContainerArchitecture.md](./ServiceContainerArchitecture.md) - "服务生命周期对比"

**推荐运行**:
```bash
npx ts-node examples/ServiceContainerExample.ts
# 查看示例3（作用域服务）和示例4（瞬时服务）
```

---

### 我想看实际应用示例

**现有服务实现**:

| 服务 | 文件 | 说明 |
|-----|------|------|
| ImportanceEvaluatorService | [ImportanceEvaluatorService.ts](../src/Memory/Services/ImportanceEvaluatorService.ts) | 记忆重要性评估 |
| MemoryCompressorService | [MemoryCompressorService.ts](../src/Memory/Services/MemoryCompressorService.ts) | 记忆压缩服务 |

**推荐阅读**:
- [ServiceRegistration.ts](../src/Core/ServiceRegistration.ts) - 如何注册这些服务
- 以上服务的源码文件

---

### 我想解决具体问题

**常见问题快速查找**:

| 问题 | 文档位置 |
|-----|---------|
| 如何在服务中获取其他服务？ | [ServiceContainer_Summary.md](./ServiceContainer_Summary.md) - 问题1 |
| ServiceRegistration.ts 是什么？ | [ServiceContainer_Summary.md](./ServiceContainer_Summary.md) - 问题2 |
| 何时使用哪种生命周期？ | [README_ServiceContainer.md](./README_ServiceContainer.md) - Q3 |
| initialize 和 dispose 必须实现吗？ | [README_ServiceContainer.md](./README_ServiceContainer.md) - Q4 |
| 如何调试容器？ | [README_ServiceContainer.md](./README_ServiceContainer.md) - Q5 |
| 如何禁用服务？ | [README_ServiceContainer.md](./README_ServiceContainer.md) - Q6 |
| 支持循环依赖吗？ | [README_ServiceContainer.md](./README_ServiceContainer.md) - Q7 |
| 如何集成到现有项目？ | [README_ServiceContainer.md](./README_ServiceContainer.md) - Q8 |

---

## 📊 学习路径推荐

### 路径1: 快速上手（30分钟）

```
1. 运行 ServiceContainerQuickStart.ts         [5分钟]
   └─> 理解三种依赖注入方式

2. 阅读 ServiceContainer_Summary.md           [10分钟]
   └─> 核心问题解答

3. 阅读 README 的"快速开始"部分             [5分钟]
   └─> 基础概念

4. 在自己项目中试用                          [10分钟]
   └─> 注册一个简单服务
```

### 路径2: 深入理解（2小时）

```
1. 运行所有示例                              [20分钟]
   ├─> ServiceContainerQuickStart.ts
   └─> ServiceContainerExample.ts

2. 阅读完整文档                              [40分钟]
   ├─> README_ServiceContainer.md
   ├─> ServiceContainerArchitecture.md
   └─> ServiceContainer_Summary.md

3. 阅读源码                                  [40分钟]
   ├─> IService.ts
   ├─> ServiceContainer.ts
   └─> ServiceRegistration.ts

4. 研究现有服务实现                          [20分钟]
   └─> ImportanceEvaluatorService.ts
```

### 路径3: 精通应用（1天）

```
1. 完成路径2的所有内容                       [2小时]

2. 设计自己的服务架构                        [2小时]
   └─> 规划服务依赖关系
   └─> 选择合适的生命周期

3. 实现并集成到项目                          [3小时]
   └─> 注册所有服务
   └─> 重构现有代码

4. 编写单元测试                              [1小时]
   └─> 使用 Mock 服务
   └─> 测试服务替换
```

---

## 🎓 按技能水平推荐

### 初学者（刚接触依赖注入）

**必读**:
- [ServiceContainer_Summary.md](./ServiceContainer_Summary.md)
- [README_ServiceContainer.md](./README_ServiceContainer.md) - 快速开始部分

**必跑**:
- [ServiceContainerQuickStart.ts](./ServiceContainerQuickStart.ts)

**建议**: 先使用方式2（工厂函数），最简单实用

---

### 中级开发者（了解依赖注入概念）

**必读**:
- [README_ServiceContainer.md](./README_ServiceContainer.md) - 完整阅读
- [ServiceContainerArchitecture.md](./ServiceContainerArchitecture.md)

**必跑**:
- [ServiceContainerExample.ts](./ServiceContainerExample.ts) - 所有6个示例

**建议**: 尝试三种依赖注入方式，理解各自优缺点

---

### 高级开发者（需要复杂架构）

**必读**:
- 所有文档
- [ServiceContainer.ts](../src/Core/ServiceContainer.ts) 源码

**必做**:
- 设计多层服务架构
- 实现自定义生命周期管理
- 优化服务性能

**建议**: 使用方式3（容器引用），最灵活强大

---

## 📱 快速参考卡片

### API 速查

```typescript
// 注册服务
container.addSingleton(name, impl, config?)
container.addScoped(name, impl, config?)
container.addTransient(name, impl, config?)
container.addFactory(name, factory, lifetime?, config?)

// 获取服务
await container.get<T>(name)
await container.tryGet<T>(name)

// 管理
container.has(name)
container.createScope(name)
await container.dispose()
```

### 生命周期速查

| 生命周期 | 创建时机 | 销毁时机 |
|---------|---------|---------|
| SINGLETON | 首次 get() | 应用关闭 |
| SCOPED | 首次 get() 在当前作用域 | 作用域关闭 |
| TRANSIENT | 每次 get() | 不自动销毁 |

### 依赖注入速查

| 方式 | 复杂度 | 灵活性 | 推荐场景 |
|-----|--------|--------|---------|
| 手动注入 | 低 | 低 | 简单项目 |
| 工厂函数 | 中 | 中 | 一般项目 ⭐ |
| 容器引用 | 高 | 高 | 复杂项目 |

---

## 🔗 外部资源

### 相关概念

- [依赖注入 (Wikipedia)](https://zh.wikipedia.org/wiki/%E4%BE%9D%E8%B5%96%E6%B3%A8%E5%85%A5)
- [控制反转 (Wikipedia)](https://zh.wikipedia.org/wiki/%E6%8E%A7%E5%88%B6%E5%8F%8D%E8%BD%AC)
- [SOLID 原则](https://zh.wikipedia.org/wiki/SOLID_(%E9%9D%A2%E5%90%91%E5%AF%B9%E8%B1%A1%E8%AE%BE%E8%AE%A1))

### 类似框架

- [InversifyJS](https://inversify.io/) - TypeScript DI 框架
- [NestJS DI](https://docs.nestjs.com/fundamentals/custom-providers) - NestJS 依赖注入
- [.NET Core DI](https://docs.microsoft.com/en-us/aspnet/core/fundamentals/dependency-injection) - .NET 依赖注入

---

## 🆘 需要帮助？

### 遇到问题？

1. **查看常见问题**: [README_ServiceContainer.md](./README_ServiceContainer.md) - 常见问题章节
2. **运行示例**: 看看示例是否能解决你的问题
3. **查看源码**: 源码注释非常详细
4. **提出 Issue**: 在项目仓库提交问题

### 想要贡献？

1. **改进文档**: 发现文档错误或不清楚的地方
2. **添加示例**: 补充更多使用场景
3. **优化代码**: 提升性能或添加功能
4. **分享经验**: 分享你的使用心得

---

## 📦 文件清单

### 文档文件（examples/）

- ✅ `ServiceContainer_INDEX.md` - 本文档，资源导航
- ✅ `ServiceContainer_Summary.md` - 总结和核心问题
- ✅ `README_ServiceContainer.md` - 完整使用指南
- ✅ `ServiceContainerArchitecture.md` - 架构图解

### 示例文件（examples/）

- ✅ `ServiceContainerQuickStart.ts` - 快速上手示例
- ✅ `ServiceContainerExample.ts` - 完整示例集合

### 核心文件（src/Core/）

- ✅ `IService.ts` - 服务接口
- ✅ `ServiceContainer.ts` - 容器实现
- ✅ `ServiceRegistration.ts` - 核心服务注册（**重要，不要删除**）
- ✅ `index.ts` - 模块导出

### 服务实现（src/Memory/Services/）

- ✅ `ImportanceEvaluatorService.ts`
- ✅ `MemoryCompressorService.ts`

---

## 🎉 开始使用

选择你的起点：

**想快速上手？**
```bash
npx ts-node examples/ServiceContainerQuickStart.ts
```

**想深入学习？**
从 [ServiceContainer_Summary.md](./ServiceContainer_Summary.md) 开始阅读

**想解决具体问题？**
查看 [README_ServiceContainer.md](./README_ServiceContainer.md) 的常见问题

**想看架构设计？**
阅读 [ServiceContainerArchitecture.md](./ServiceContainerArchitecture.md)

---

## 📝 更新日志

- 2026-02-06: 创建完整文档和示例集合
  - ✅ 4个文档文件
  - ✅ 2个示例文件
  - ✅ 核心问题解答
  - ✅ 架构图解

---

**祝你使用愉快！** 🚀

有任何问题欢迎查阅文档或运行示例代码。
