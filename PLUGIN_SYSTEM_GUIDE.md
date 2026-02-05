# SBot 插件系统完整指南

## 📖 目录

- [概述](#概述)
- [核心概念](#核心概念)
- [快速开始](#快速开始)
- [使用内置插件](#使用内置插件)
- [创建自定义插件](#创建自定义插件)
- [插件配置](#插件配置)
- [插件通信](#插件通信)
- [高级特性](#高级特性)
- [最佳实践](#最佳实践)
- [API 参考](#api-参考)

---

## 概述

SBot 插件系统是一个灵活、可扩展的架构，允许你轻松添加新功能或修改现有行为。

### 主要特性

- ✅ **事件驱动**：基于 EventBus 的插件间通信
- ✅ **生命周期管理**：自动化的加载、卸载和资源清理
- ✅ **钩子系统**：在关键点拦截和修改行为
- ✅ **依赖管理**：自动解析插件依赖关系
- ✅ **优先级控制**：精确控制插件执行顺序
- ✅ **配置驱动**：通过配置文件启用/禁用插件

---

## 核心概念

### 1. 插件（Plugin）

插件是实现 `IPlugin` 接口的类，提供特定功能。

```typescript
interface IPlugin {
  metadata: PluginMetadata;  // 插件元数据
  isLoaded?: boolean;         // 加载状态

  // 生命周期钩子
  onLoad?(context: PluginContext): Promise<void>;
  onUnload?(): Promise<void>;

  // 查询处理钩子
  onBeforeQuery?(query: string, context: any): Promise<string>;
  onAfterResponse?(response: string, query: string, context: any): Promise<string>;

  // 消息钩子
  onMessage?(message: AgentMessage, context: any): Promise<AgentMessage>;

  // 工具钩子
  onBeforeToolCall?(toolName: string, args: any, context: any): Promise<void>;
  onAfterToolCall?(toolName: string, result: any, context: any): Promise<void>;

  // 错误处理
  onError?(error: Error, context: any): Promise<void>;
}
```

### 2. 插件管理器（PluginManager）

负责插件的注册、加载、卸载和钩子执行。

```typescript
const manager = new PluginManager();

// 注册插件
await manager.register(plugin, {
  enabled: true,
  priority: 10,
  config: { /* ... */ }
});

// 执行钩子
const result = await manager.executeHook("onBeforeQuery", data, context);
```

### 3. 事件总线（EventBus）

插件间通信的核心机制。

```typescript
// 发送事件
eventBus.emit("user:login", { userId: "123" });

// 监听事件
eventBus.on("user:login", (data) => {
  console.log(`用户 ${data.userId} 登录`);
});
```

### 4. 插件上下文（PluginContext）

提供给插件的运行环境。

```typescript
interface PluginContext {
  eventBus: EventBus;                 // 事件总线
  config: Record<string, any>;        // 插件配置
  logger: any;                        // 日志服务
  getPlugin?: (name: string) => IPlugin | undefined;  // 获取其他插件
}
```

---

## 快速开始

### 1. 使用全局插件管理器

```typescript
import { globalPluginManager, registerCorePlugins } from "./src/Plugin";

// 注册所有核心插件
await registerCorePlugins(globalPluginManager);

// 执行钩子
const enhancedQuery = await globalPluginManager.executeHook(
  "onBeforeQuery",
  "用户查询",
  {}
);
```

### 2. 创建独立插件管理器

```typescript
import { PluginManager } from "./src/Plugin";

const manager = new PluginManager("my-app");

// 注册插件
await manager.register(myPlugin, { enabled: true });
```

---

## 使用内置插件

### MemoryPlugin（长期记忆插件）

为 Agent 提供长期记忆功能，支持语义检索和重要性评估。

#### 配置

在 `~/.sbot/settings.toml` 中配置：

```toml
[plugins.MemoryPlugin]
enabled = true
priority = 10

[plugins.MemoryPlugin.config]
dbPath = "memory.db"
autoMemorize = true
memorizeThreshold = 0.5
autoRetrieve = true
retrievalLimit = 5
enableLLMEvaluation = true
enableCompression = true

[plugins.MemoryPlugin.config.embeddingConfig]
apiKey = "your-api-key"
baseURL = "https://api.openai.com/v1"
model = "text-embedding-ada-002"
```

#### 使用

```typescript
import { MemoryPlugin } from "./src/Plugin";

// 获取插件实例
const memoryPlugin = globalPluginManager.getPlugin("MemoryPlugin") as MemoryPlugin;

// 添加记忆
const memoryId = await memoryPlugin.addMemory(
  "用户喜欢吃披萨",
  MemoryType.SEMANTIC,
  0.8
);

// 检索记忆
const memories = await memoryPlugin.retrieveMemories("用户喜欢什么食物？", 5);

// 获取统计信息
const stats = await memoryPlugin.getStatistics();
```

#### 自动功能

**自动检索**：在查询前自动检索相关记忆并注入上下文

```typescript
// 原始查询
"今天吃什么好？"

// 增强后的查询
"相关记忆：
[记忆1] 用户喜欢吃披萨
[记忆2] 用户不喜欢辣的食物

用户查询：今天吃什么好？"
```

**自动记忆**：响应后自动记忆重要对话

```typescript
// 用户查询和 AI 响应会自动存储到记忆数据库
// 使用 LLM 评估重要性，只保留重要对话
```

#### 命令支持

MemoryPlugin 支持特殊命令：

```typescript
"/memory stats"          // 获取记忆统计
"/memory search 关键词"   // 搜索记忆
"/memory compress"       // 压缩记忆
```

---

## 创建自定义插件

### 基本插件

```typescript
import { BasePlugin, PluginMetadata, PluginContext } from "./src/Plugin";

export class MyPlugin extends BasePlugin {
  metadata: PluginMetadata = {
    name: "MyPlugin",
    version: "1.0.0",
    description: "我的自定义插件",
    author: "Your Name"
  };

  async onLoad(context: PluginContext): Promise<void> {
    await super.onLoad(context);
    this.context?.logger.info("MyPlugin 已加载");
  }

  async onUnload(): Promise<void> {
    this.context?.logger.info("MyPlugin 已卸载");
    await super.onUnload();
  }

  async onBeforeQuery(query: string, context: any): Promise<string> {
    // 修改查询
    return `[增强] ${query}`;
  }
}
```

### 注册自定义插件

```typescript
const myPlugin = new MyPlugin();

await globalPluginManager.register(myPlugin, {
  enabled: true,
  priority: 15,
  config: {
    option1: "value1",
    option2: 123
  }
});
```

---

## 插件配置

### 方式1：代码配置

```typescript
await manager.register(plugin, {
  enabled: true,           // 是否启用
  priority: 10,            // 优先级（数字越小越先执行）
  config: {                // 插件特定配置
    apiKey: "xxx",
    timeout: 5000
  }
});
```

### 方式2：配置文件

在 `~/.sbot/settings.toml` 中：

```toml
[plugins.MyPlugin]
enabled = true
priority = 15

[plugins.MyPlugin.config]
apiKey = "your-api-key"
timeout = 5000
```

### 读取配置

在插件中使用 `getConfig` 方法：

```typescript
export class MyPlugin extends BasePlugin {
  async onLoad(context: PluginContext): Promise<void> {
    await super.onLoad(context);

    // 读取配置
    const apiKey = this.getConfig<string>("apiKey", "default-key");
    const timeout = this.getConfig<number>("timeout", 3000);

    this.context?.logger.info(`API Key: ${apiKey}, Timeout: ${timeout}`);
  }
}
```

---

## 插件通信

### 发送事件

```typescript
export class SenderPlugin extends BasePlugin {
  async doSomething() {
    // 发送事件
    this.emit("data:updated", {
      timestamp: Date.now(),
      value: 123
    });
  }
}
```

### 监听事件

```typescript
export class ReceiverPlugin extends BasePlugin {
  async onLoad(context: PluginContext): Promise<void> {
    await super.onLoad(context);

    // 监听事件
    this.on("data:updated", (data: any) => {
      this.context?.logger.info(`收到数据: ${data.value}`);
    });
  }
}
```

### 等待事件

```typescript
// 等待特定事件
const data = await eventBus.waitFor("data:ready", 5000);
```

---

## 高级特性

### 1. 插件依赖

```typescript
export class AnalyticsPlugin extends BasePlugin {
  metadata: PluginMetadata = {
    name: "AnalyticsPlugin",
    version: "1.0.0",
    description: "分析插件",
    dependencies: ["DataServicePlugin"]  // 声明依赖
  };

  private dataService?: DataServicePlugin;

  async onLoad(context: PluginContext): Promise<void> {
    await super.onLoad(context);

    // 获取依赖的插件
    this.dataService = context.getPlugin?.("DataServicePlugin") as DataServicePlugin;

    if (!this.dataService) {
      throw new Error("依赖的 DataServicePlugin 未找到");
    }
  }
}
```

**注意**：依赖的插件必须先注册，否则会抛出异常。

### 2. 钩子链

多个插件可以实现同一个钩子，按优先级依次执行：

```typescript
// FilterPlugin (priority: 10) - 先执行
async onBeforeQuery(query: string): Promise<string> {
  return query.replace(/敏感词/g, "***");
}

// PrefixPlugin (priority: 20) - 后执行
async onBeforeQuery(query: string): Promise<string> {
  return `[用户] ${query}`;
}

// 最终结果：[用户] 这是一个包含***的查询
```

### 3. 条件加载

```typescript
await manager.register(plugin, {
  enabled: process.env.NODE_ENV === "production",
  priority: 10
});
```

### 4. 动态重载

```typescript
import { reloadPlugins } from "./src/Plugin";

// 重新加载所有插件（重新读取配置）
await reloadPlugins();
```

### 5. 调试插件

```typescript
// 打印插件管理器信息
manager.debug();

// 输出：
// === PluginManager 调试信息 ===
// 总插件数: 3
// 已加载插件数: 2
//
// 插件列表（按优先级）:
//   ✓ MemoryPlugin v1.0.0 (启用, 优先级: 10)
//   ✓ MyPlugin v1.0.0 (启用, 优先级: 15)
//   ✗ DisabledPlugin v1.0.0 (禁用, 优先级: 20)
```

---

## 最佳实践

### 1. 插件命名

使用后缀 `Plugin`：

```typescript
// ✅ 好的命名
MemoryPlugin
QueryLogPlugin
AnalyticsPlugin

// ❌ 不好的命名
Memory
Logger
Plugin1
```

### 2. 优先级分配

建议的优先级范围：

| 优先级范围 | 用途 |
|----------|------|
| 0-9      | 系统级插件（预处理） |
| 10-49    | 核心功能插件 |
| 50-99    | 增强功能插件 |
| 100+     | 后处理插件 |

### 3. 错误处理

```typescript
async onBeforeQuery(query: string, context: any): Promise<string> {
  try {
    // 插件逻辑
    return processQuery(query);
  } catch (error: any) {
    // 记录错误但不中断流程
    this.context?.logger.error(`处理查询失败: ${error.message}`);
    return query; // 返回原始查询
  }
}
```

### 4. 资源清理

```typescript
async onLoad(context: PluginContext): Promise<void> {
  await super.onLoad(context);

  // 创建资源
  this.timer = setInterval(() => {
    // 定时任务
  }, 1000);
}

async onUnload(): Promise<void> {
  // 清理资源
  if (this.timer) {
    clearInterval(this.timer);
  }

  await super.onUnload();
}
```

### 5. 避免循环依赖

```typescript
// ❌ 错误：A 依赖 B，B 依赖 A
PluginA.dependencies = ["PluginB"];
PluginB.dependencies = ["PluginA"];

// ✅ 正确：提取共同依赖到独立服务
PluginA.dependencies = ["SharedService"];
PluginB.dependencies = ["SharedService"];
```

---

## API 参考

### PluginManager

#### 注册和管理

```typescript
// 注册插件
register(plugin: IPlugin, config?: PluginConfig): Promise<void>

// 注销插件
unregister(name: string): Promise<void>

// 加载插件
load(name: string): Promise<void>

// 卸载插件
unload(name: string): Promise<void>

// 重新加载插件
reload(name: string): Promise<void>

// 启用插件
enable(name: string): Promise<void>

// 禁用插件
disable(name: string): Promise<void>

// 卸载所有插件
unloadAll(): Promise<void>
```

#### 查询插件

```typescript
// 获取插件实例
getPlugin(name: string): IPlugin | undefined

// 获取所有已加载的插件
getLoadedPlugins(): IPlugin[]

// 获取所有插件元数据
getPluginMetadata(): PluginMetadata[]

// 检查插件是否已注册
hasPlugin(name: string): boolean

// 检查插件是否已加载
isPluginLoaded(name: string): boolean

// 获取插件数量
getPluginCount(): number
```

#### 钩子执行

```typescript
// 执行插件钩子
executeHook<T>(
  hookName: PluginHookType,
  data: T,
  context?: any
): Promise<T>
```

#### 调试

```typescript
// 打印调试信息
debug(): void
```

### EventBus

```typescript
// 发送事件
emit(event: string, data?: any): void

// 监听事件
on(event: string, handler: (data: any) => void | Promise<void>): () => void

// 监听一次
once(event: string, handler: (data: any) => void | Promise<void>): () => void

// 监听所有事件
onAny(handler: (event: string, data: any) => void | Promise<void>): () => void

// 等待事件
waitFor<T>(event: string, timeout?: number): Promise<T>

// 移除监听器
off(event: string, handler?: (data: any) => void | Promise<void>): void

// 清除所有监听器
clear(): void
```

### BasePlugin

```typescript
// 发送事件
protected emit(event: string, data?: any): void

// 监听事件
protected on(event: string, handler: (data: any) => void | Promise<void>): () => void

// 获取配置
protected getConfig<T>(key: string, defaultValue?: T): T
```

---

## 示例代码

完整示例请查看：
- [examples/plugin-system-example.ts](examples/plugin-system-example.ts)

---

## 相关文档

- [src/Plugin/IPlugin.ts](src/Plugin/IPlugin.ts) - 插件接口定义
- [src/Plugin/PluginManager.ts](src/Plugin/PluginManager.ts) - 插件管理器实现
- [src/Plugin/EventBus.ts](src/Plugin/EventBus.ts) - 事件总线实现
- [src/Plugin/plugins/MemoryPlugin.ts](src/Plugin/plugins/MemoryPlugin.ts) - 记忆插件实现

---

**使用插件系统，让 SBot 更加灵活和可扩展！** 🚀
