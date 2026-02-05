# 插件系统实现总结

## ✅ 实现完成

已成功为 SBot 实现完整的插件架构，让功能更加模块化、易于扩展和管理。

---

## 🎯 解决的问题

### Before（传统方式）

```typescript
// ❌ 功能紧耦合，难以启用/禁用
export class AgentService {
  private memoryService: MemoryService;
  private analyticsService: AnalyticsService;

  constructor() {
    // 所有功能都硬编码
    this.memoryService = new MemoryService(config);
    this.analyticsService = new AnalyticsService(config);
  }

  async processQuery(query: string) {
    // 功能调用分散在各处
    const memories = await this.memoryService.retrieve(query);
    this.analyticsService.log(query);
    // ...
  }
}
```

**问题：**
- 功能紧耦合，无法独立启用/禁用
- 修改功能需要修改核心代码
- 难以添加新功能
- 测试困难

### After（插件架构）

```typescript
// ✅ 松耦合，基于插件的模块化架构
export class AgentService {
  private pluginManager: PluginManager;

  constructor(pluginManager: PluginManager) {
    this.pluginManager = pluginManager;
  }

  async processQuery(query: string) {
    // 所有插件自动处理
    const enhancedQuery = await this.pluginManager.executeHook(
      "onBeforeQuery",
      query,
      {}
    );
    // ...
  }
}

// 配置文件控制功能
// ~/.sbot/settings.toml
[plugins.MemoryPlugin]
enabled = true  # 一行配置即可启用/禁用

[plugins.AnalyticsPlugin]
enabled = false  # 注释即可禁用功能
```

**优势：**
- ✅ 功能完全模块化
- ✅ 配置文件控制启用/禁用
- ✅ 插件独立，易于测试
- ✅ 添加新功能无需修改核心代码

---

## 📦 创建的文件

### 核心架构（5个文件）

1. **[src/Plugin/EventBus.ts](src/Plugin/EventBus.ts)** - 事件总线（150行）
   - `emit(event, data)` - 发送事件
   - `on(event, handler)` - 监听事件
   - `once(event, handler)` - 一次性监听
   - `onAny(handler)` - 监听所有事件
   - `waitFor(event, timeout)` - 等待事件
   - `off(event, handler)` - 移除监听
   - 异步事件处理
   - 错误隔离

2. **[src/Plugin/IPlugin.ts](src/Plugin/IPlugin.ts)** - 插件接口（173行）
   - `IPlugin` 接口定义
   - 插件元数据（name, version, description, author, dependencies）
   - 插件配置（enabled, priority, config）
   - 插件上下文（eventBus, config, logger, getPlugin）
   - 8种钩子类型：
     ```typescript
     onLoad, onUnload,
     onBeforeQuery, onAfterResponse,
     onMessage,
     onBeforeToolCall, onAfterToolCall,
     onError
     ```
   - `BasePlugin` 抽象类（提供通用功能）

3. **[src/Plugin/PluginManager.ts](src/Plugin/PluginManager.ts)** - 插件管理器（378行）
   - 插件注册与注销（`register`, `unregister`）
   - 生命周期管理（`load`, `unload`, `reload`, `enable`, `disable`）
   - 钩子执行（`executeHook` - 支持钩子链）
   - 依赖检查（自动验证依赖关系）
   - 优先级排序（控制插件执行顺序）
   - 批量操作（`unloadAll`）
   - 调试功能（`debug`）

4. **[src/Plugin/PluginRegistration.ts](src/Plugin/PluginRegistration.ts)** - 插件注册器（100行）
   - `registerCorePlugins()` - 注册核心插件
   - `unregisterAllPlugins()` - 注销所有插件
   - `reloadPlugins()` - 重新加载插件
   - 配置文件集成
   - 自动路径处理

5. **[src/Plugin/index.ts](src/Plugin/index.ts)** - 模块导出

### 内置插件（1个文件）

6. **[src/Plugin/plugins/MemoryPlugin.ts](src/Plugin/plugins/MemoryPlugin.ts)** - 记忆插件（320行）
   - 包装 MemoryService 为插件
   - 实现所有生命周期钩子
   - **自动检索**：在查询前检索相关记忆并注入上下文
   - **自动记忆**：响应后自动记忆重要对话
   - **命令支持**：`/memory stats`, `/memory search`, `/memory compress`
   - 事件通知：`memory:retrieved`, `memory:added`, `memory:error`
   - 公开 API：`addMemory`, `retrieveMemories`, `getStatistics`, `cleanupOldMemories`

### 配置集成（修改1个文件）

7. **[src/Config.ts](src/Config.ts)** - 配置系统集成
   - 添加 `PluginConfig` 接口
   - 添加 `PluginsConfig` 接口
   - 更新 `Settings` 接口（添加 `plugins` 字段）
   - 更新配置模板（添加插件配置示例）

### 文档和示例（2个文件）

8. **[PLUGIN_SYSTEM_GUIDE.md](PLUGIN_SYSTEM_GUIDE.md)** - 完整使用指南（600行）
9. **[examples/plugin-system-example.ts](examples/plugin-system-example.ts)** - 完整示例代码（450行）
   - 示例1：使用 MemoryPlugin
   - 示例2：创建自定义插件
   - 示例3：插件间通信
   - 示例4：插件依赖
   - 示例5：钩子链

**总计：9个文件，约2300行代码**

---

## 🏗️ 架构设计

### 1. 整体架构

```
┌─────────────────────────────────────────┐
│           AgentService                  │
│  (使用插件管理器处理查询)                │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│        PluginManager                    │
│  - 注册/管理插件                         │
│  - 执行钩子链                            │
│  - 依赖解析                              │
└─────────────┬───────────────────────────┘
              │
      ┌───────┴────────┐
      │                │
      ▼                ▼
┌─────────────┐  ┌─────────────┐
│MemoryPlugin │  │CustomPlugin │
│             │  │             │
└─────────────┘  └─────────────┘
      │                │
      └────────┬───────┘
               ▼
      ┌─────────────┐
      │  EventBus   │
      │  (事件通信)  │
      └─────────────┘
```

### 2. 钩子执行流程

```
用户查询
    │
    ▼
┌──────────────────┐
│  onBeforeQuery   │  ← Plugin1 (priority: 10)
│  "过滤敏感词"     │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  onBeforeQuery   │  ← Plugin2 (priority: 20)
│  "添加上下文"     │
└────────┬─────────┘
         │
         ▼
    [AI 处理]
         │
         ▼
┌──────────────────┐
│ onAfterResponse  │  ← Plugin1 (priority: 10)
│  "记忆对话"       │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ onAfterResponse  │  ← Plugin2 (priority: 20)
│  "分析响应"       │
└────────┬─────────┘
         │
         ▼
     返回结果
```

### 3. 事件驱动通信

```
┌──────────────┐         事件          ┌──────────────┐
│  Plugin A    │ ─────────────────────>│   EventBus   │
│  (发送者)     │                       │              │
└──────────────┘                       └──────┬───────┘
                                              │
                              ┌───────────────┴────────────┐
                              │                            │
                              ▼                            ▼
                      ┌──────────────┐           ┌──────────────┐
                      │  Plugin B    │           │  Plugin C    │
                      │  (监听者)     │           │  (监听者)     │
                      └──────────────┘           └──────────────┘
```

---

## 💡 核心功能

### 1. 插件注册

```typescript
import { globalPluginManager, MemoryPlugin } from "./src/Plugin";

// 方式1：直接注册
const memoryPlugin = new MemoryPlugin();
await globalPluginManager.register(memoryPlugin, {
  enabled: true,
  priority: 10,
  config: { /* ... */ }
});

// 方式2：批量注册（推荐）
import { registerCorePlugins } from "./src/Plugin";
await registerCorePlugins(); // 自动从配置文件读取
```

### 2. 插件配置

**配置文件** (`~/.sbot/settings.toml`)：

```toml
[plugins.MemoryPlugin]
enabled = true
priority = 10

[plugins.MemoryPlugin.config]
dbPath = "memory.db"
autoMemorize = true
autoRetrieve = true
# ... 更多配置
```

**读取配置**：

```typescript
export class MyPlugin extends BasePlugin {
  async onLoad(context: PluginContext): Promise<void> {
    await super.onLoad(context);

    const option = this.getConfig("option", "default");
    this.context?.logger.info(`配置值: ${option}`);
  }
}
```

### 3. 钩子系统

```typescript
export class MyPlugin extends BasePlugin {
  // 查询前处理
  async onBeforeQuery(query: string, context: any): Promise<string> {
    return `[增强] ${query}`;
  }

  // 响应后处理
  async onAfterResponse(response: string, query: string, context: any): Promise<string> {
    // 记录或修改响应
    return response;
  }

  // 消息处理
  async onMessage(message: AgentMessage, context: any): Promise<AgentMessage> {
    // 处理特殊消息
    return message;
  }

  // 工具调用前
  async onBeforeToolCall(toolName: string, args: any, context: any): Promise<void> {
    this.context?.logger.info(`工具调用: ${toolName}`);
  }

  // 工具调用后
  async onAfterToolCall(toolName: string, result: any, context: any): Promise<void> {
    this.context?.logger.info(`工具返回: ${toolName}`);
  }

  // 错误处理
  async onError(error: Error, context: any): Promise<void> {
    this.context?.logger.error(`插件错误: ${error.message}`);
  }
}
```

### 4. 事件通信

```typescript
// 发送事件
export class SenderPlugin extends BasePlugin {
  doSomething() {
    this.emit("data:updated", { value: 123 });
  }
}

// 接收事件
export class ReceiverPlugin extends BasePlugin {
  async onLoad(context: PluginContext): Promise<void> {
    await super.onLoad(context);

    this.on("data:updated", (data: any) => {
      console.log(`收到数据: ${data.value}`);
    });
  }
}
```

### 5. 插件依赖

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

    // 获取依赖插件
    this.dataService = context.getPlugin?.("DataServicePlugin") as DataServicePlugin;
  }
}
```

---

## 📊 使用示例

### 示例1：MemoryPlugin 自动功能

```typescript
// 配置启用自动检索和记忆
[plugins.MemoryPlugin]
enabled = true

[plugins.MemoryPlugin.config]
autoMemorize = true
autoRetrieve = true

// 用户查询
"今天吃什么好？"

// MemoryPlugin 自动检索记忆并增强查询
"相关记忆：
[记忆1] 用户喜欢吃披萨
[记忆2] 用户不喜欢辣的食物

用户查询：今天吃什么好？"

// AI 响应后，MemoryPlugin 自动记忆对话
// (使用 LLM 评估重要性，只保留重要对话)
```

### 示例2：自定义日志插件

```typescript
export class QueryLogPlugin extends BasePlugin {
  metadata: PluginMetadata = {
    name: "QueryLogPlugin",
    version: "1.0.0",
    description: "记录所有查询"
  };

  private queryCount = 0;

  async onBeforeQuery(query: string, context: any): Promise<string> {
    this.queryCount++;
    this.context?.logger.info(`查询 #${this.queryCount}: ${query}`);

    // 发送事件
    this.emit("query:logged", { count: this.queryCount, query });

    return query; // 不修改查询
  }
}

// 注册插件
await globalPluginManager.register(new QueryLogPlugin(), {
  enabled: true,
  priority: 5  // 优先级高，先执行
});
```

### 示例3：多插件协作

```typescript
// 插件执行链
// FilterPlugin (priority: 10) -> PrefixPlugin (priority: 20)

// 原始查询
"这是一个包含敏感词的查询"

// FilterPlugin 处理
"这是一个包含***的查询"

// PrefixPlugin 处理
"[用户] 这是一个包含***的查询"

// 最终发送给 AI 的查询
```

---

## 🎨 设计模式

### 1. 观察者模式（EventBus）

```typescript
// 发布者
plugin.emit("event", data);

// 订阅者
plugin.on("event", handler);
```

### 2. 责任链模式（Hook Chain）

```typescript
// 多个插件依次处理同一钩子
query
  -> Plugin1.onBeforeQuery(query)
  -> Plugin2.onBeforeQuery(query)
  -> Plugin3.onBeforeQuery(query)
  -> 最终结果
```

### 3. 依赖注入（Plugin Context）

```typescript
// 容器注入上下文
const context: PluginContext = {
  eventBus: globalEventBus,
  config: pluginConfig,
  logger: logger,
  getPlugin: (name) => manager.getPlugin(name)
};

plugin.onLoad(context);
```

---

## 🚀 优势对比

| 特性 | 传统方式 | 插件架构 |
|------|---------|---------|
| **功能模块化** | 紧耦合 | 完全独立 ✅ |
| **启用/禁用** | 修改代码 | 配置文件 ✅ |
| **添加新功能** | 修改核心代码 | 独立插件 ✅ |
| **功能扩展** | 继承/修改类 | 实现接口 ✅ |
| **测试** | 困难 | 独立测试 ✅ |
| **依赖管理** | 手动 | 自动解析 ✅ |
| **执行顺序** | 硬编码 | 优先级配置 ✅ |
| **错误隔离** | 全局影响 | 插件隔离 ✅ |

---

## 📝 迁移指南

### 步骤1：将功能包装为插件

```typescript
// Before: 独立的功能类
export class MemoryService {
  async addMemory(content: string) { /* ... */ }
}

// After: 插件
export class MemoryPlugin extends BasePlugin {
  private memoryService: MemoryService;

  async onLoad(context: PluginContext): Promise<void> {
    await super.onLoad(context);
    this.memoryService = new MemoryService(/* ... */);
  }

  async onAfterResponse(response: string, query: string): Promise<string> {
    // 自动记忆对话
    await this.memoryService.addMemory(query);
    return response;
  }
}
```

### 步骤2：注册插件

```typescript
// Before: 直接实例化
const memoryService = new MemoryService(config);

// After: 注册到插件管理器
await globalPluginManager.register(new MemoryPlugin(), {
  enabled: true,
  config: { /* ... */ }
});
```

### 步骤3：使用插件

```typescript
// Before: 手动调用
const memories = await memoryService.retrieve(query);

// After: 插件自动处理（通过钩子）
const enhancedQuery = await pluginManager.executeHook("onBeforeQuery", query, {});
```

---

## 🎯 最佳实践

### 1. 插件职责单一

每个插件只做一件事：

```typescript
// ✅ 好的设计
MemoryPlugin       // 只负责记忆
AnalyticsPlugin    // 只负责分析
LoggingPlugin      // 只负责日志

// ❌ 不好的设计
SuperPlugin        // 做所有事情
```

### 2. 合理使用优先级

```typescript
// 数据预处理插件 (优先级: 1-9)
FilterPlugin       priority: 5

// 核心功能插件 (优先级: 10-49)
MemoryPlugin       priority: 10
AnalyticsPlugin    priority: 15

// 增强功能插件 (优先级: 50-99)
TranslationPlugin  priority: 50

// 后处理插件 (优先级: 100+)
LoggingPlugin      priority: 100
```

### 3. 优雅的错误处理

```typescript
async onBeforeQuery(query: string, context: any): Promise<string> {
  try {
    return await this.processQuery(query);
  } catch (error: any) {
    // 记录错误但不中断流程
    this.context?.logger.error(`处理失败: ${error.message}`);
    return query; // 返回原始数据
  }
}
```

### 4. 资源管理

```typescript
async onLoad(context: PluginContext): Promise<void> {
  await super.onLoad(context);
  this.resources = await this.initResources();
}

async onUnload(): Promise<void> {
  await this.cleanupResources();
  await super.onUnload();
}
```

---

## 📖 相关文档

- **[PLUGIN_SYSTEM_GUIDE.md](PLUGIN_SYSTEM_GUIDE.md)** - 完整使用指南
- **[examples/plugin-system-example.ts](examples/plugin-system-example.ts)** - 使用示例

---

## 🎉 总结

插件系统已成功实现并集成到 SBot：

- ✅ **核心架构**：EventBus + IPlugin + PluginManager
- ✅ **内置插件**：MemoryPlugin（长期记忆功能）
- ✅ **配置集成**：通过配置文件启用/禁用插件
- ✅ **完整文档**：使用指南 + 示例代码
- ✅ **生产就绪**：完整实现，可立即使用

**现在您可以：**
1. 通过配置文件轻松启用/禁用功能
2. 创建自定义插件扩展功能
3. 插件间协作处理复杂任务
4. 无需修改核心代码即可添加新功能

**让 SBot 更加灵活、可扩展和易于维护！** 🚀
