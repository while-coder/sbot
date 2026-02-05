# SBot 插件系统

> 让功能模块化、易于扩展的插件架构

## 📋 概览

SBot 插件系统是一个完整的、生产就绪的插件架构，允许你：

- ✅ **模块化功能**：每个功能独立为插件
- ✅ **配置驱动**：通过配置文件启用/禁用功能
- ✅ **事件驱动**：插件间松耦合通信
- ✅ **钩子系统**：在关键点拦截和修改行为
- ✅ **依赖管理**：自动解析插件依赖关系
- ✅ **易于扩展**：5分钟创建新插件

---

## 🚀 快速开始

### 1. 使用内置插件

**配置文件** (`~/.sbot/settings.toml`)：

```toml
[plugins.MemoryPlugin]
enabled = true
priority = 10

[plugins.MemoryPlugin.config]
dbPath = "memory.db"
autoMemorize = true
autoRetrieve = true

[plugins.MemoryPlugin.config.embeddingConfig]
apiKey = "your-api-key"
baseURL = "https://api.openai.com/v1"
model = "text-embedding-ada-002"
```

**代码中使用**：

```typescript
import { globalPluginManager, registerCorePlugins } from "./src/Plugin";

// 注册所有插件
await registerCorePlugins();

// 插件自动工作，无需手动调用！
// MemoryPlugin 会自动：
// - 在查询前检索相关记忆
// - 在响应后记忆重要对话
```

### 2. 创建自定义插件

```typescript
import { BasePlugin, PluginMetadata, PluginContext } from "./src/Plugin";

export class MyPlugin extends BasePlugin {
  metadata: PluginMetadata = {
    name: "MyPlugin",
    version: "1.0.0",
    description: "我的自定义插件"
  };

  async onLoad(context: PluginContext): Promise<void> {
    await super.onLoad(context);
    this.context?.logger.info("MyPlugin 已加载");
  }

  async onBeforeQuery(query: string, context: any): Promise<string> {
    // 处理查询
    return `[增强] ${query}`;
  }
}
```

### 3. 注册自定义插件

```typescript
import { globalPluginManager } from "./src/Plugin";

await globalPluginManager.register(new MyPlugin(), {
  enabled: true,
  priority: 15,
  config: {
    option1: "value1"
  }
});
```

---

## 📦 文件结构

```
src/Plugin/
├── EventBus.ts              # 事件总线
├── IPlugin.ts               # 插件接口
├── PluginManager.ts         # 插件管理器
├── PluginRegistration.ts    # 插件注册
├── index.ts                 # 模块导出
└── plugins/
    └── MemoryPlugin.ts      # 记忆插件

examples/
└── plugin-system-example.ts # 完整示例

文档/
├── PLUGIN_SYSTEM_GUIDE.md       # 完整使用指南（600行）
├── PLUGIN_SYSTEM_SUMMARY.md     # 实现总结
└── PLUGIN_SYSTEM_QUICK_REF.md   # 快速参考
```

---

## 🎯 核心概念

### 1. 插件钩子

插件可以实现多种钩子来拦截和修改行为：

| 钩子 | 用途 | 示例 |
|------|------|------|
| `onBeforeQuery` | 查询前处理 | 添加上下文、过滤敏感词 |
| `onAfterResponse` | 响应后处理 | 记忆对话、分析响应 |
| `onMessage` | 消息处理 | 处理特殊命令 |
| `onBeforeToolCall` | 工具调用前 | 记录日志、权限检查 |
| `onAfterToolCall` | 工具调用后 | 缓存结果、统计 |
| `onLoad` | 插件加载 | 初始化资源 |
| `onUnload` | 插件卸载 | 清理资源 |
| `onError` | 错误处理 | 记录错误、恢复 |

### 2. 钩子执行链

多个插件可以实现同一钩子，按优先级依次执行：

```
原始查询: "这是一个包含敏感词的查询"
    ↓
FilterPlugin (priority: 10)
    ↓ "这是一个包含***的查询"
PrefixPlugin (priority: 20)
    ↓ "[用户] 这是一个包含***的查询"
最终查询
```

### 3. 事件通信

插件间通过事件总线松耦合通信：

```typescript
// 插件A：发送事件
this.emit("user:login", { userId: "123" });

// 插件B：接收事件
this.on("user:login", (data) => {
  console.log(`用户 ${data.userId} 登录`);
});
```

### 4. 依赖管理

插件可以声明依赖其他插件：

```typescript
metadata: PluginMetadata = {
  name: "AnalyticsPlugin",
  dependencies: ["DataServicePlugin"]
};
```

---

## 📚 内置插件

### MemoryPlugin（长期记忆插件）

为 Agent 提供长期记忆功能。

**主要特性：**

- ✅ **自动记忆**：响应后自动记忆重要对话
- ✅ **自动检索**：查询前自动检索相关记忆
- ✅ **语义检索**：基于向量相似度的语义搜索
- ✅ **LLM 评估**：使用 LLM 评估记忆重要性
- ✅ **记忆压缩**：自动合并相似记忆节省空间
- ✅ **命令支持**：`/memory stats`, `/memory search`, `/memory compress`

**工作流程：**

```
用户查询 "今天吃什么好？"
    ↓
MemoryPlugin.onBeforeQuery
    ↓ 检索相关记忆
    ↓ "相关记忆：
       [记忆1] 用户喜欢吃披萨
       [记忆2] 用户不喜欢辣的食物

       用户查询：今天吃什么好？"
    ↓
AI 处理
    ↓
MemoryPlugin.onAfterResponse
    ↓ 记忆对话（使用LLM评估重要性）
```

---

## 🎨 使用场景

### 场景1：查询增强

```typescript
export class ContextEnhancerPlugin extends BasePlugin {
  async onBeforeQuery(query: string, context: any): Promise<string> {
    // 添加系统提示
    return `你是一个专业助手。\n\n用户查询：${query}`;
  }
}
```

### 场景2：响应后处理

```typescript
export class ResponseLoggerPlugin extends BasePlugin {
  async onAfterResponse(response: string, query: string, context: any): Promise<string> {
    // 记录对话
    await this.logConversation(query, response);
    return response;
  }
}
```

### 场景3：命令处理

```typescript
export class CommandPlugin extends BasePlugin {
  async onMessage(message: AgentMessage, context: any): Promise<AgentMessage> {
    if (message.content?.startsWith("/help")) {
      message.content = "可用命令：\n/help - 帮助\n/status - 状态";
    }
    return message;
  }
}
```

### 场景4：工具监控

```typescript
export class ToolMonitorPlugin extends BasePlugin {
  async onBeforeToolCall(toolName: string, args: any, context: any): Promise<void> {
    console.log(`调用工具: ${toolName}`);
  }

  async onAfterToolCall(toolName: string, result: any, context: any): Promise<void> {
    console.log(`工具返回: ${toolName}`);
  }
}
```

---

## 🔧 配置管理

### 方式1：配置文件

**推荐用于生产环境**

在 `~/.sbot/settings.toml` 中配置：

```toml
[plugins.MyPlugin]
enabled = true
priority = 10

[plugins.MyPlugin.config]
apiKey = "your-api-key"
timeout = 5000
```

### 方式2：代码配置

**推荐用于测试和开发**

```typescript
await manager.register(plugin, {
  enabled: true,
  priority: 10,
  config: {
    apiKey: "your-api-key",
    timeout: 5000
  }
});
```

---

## 📊 架构图

### 整体架构

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
└─────────────┘  └─────────────┘
      │                │
      └────────┬───────┘
               ▼
      ┌─────────────┐
      │  EventBus   │
      │  (事件通信)  │
      └─────────────┘
```

### 插件生命周期

```
注册 (register)
    ↓
加载 (load) → onLoad()
    ↓
运行中 ← → 执行钩子
    ↓
卸载 (unload) → onUnload()
    ↓
注销 (unregister)
```

---

## 📖 文档导航

| 文档 | 说明 | 适合 |
|------|------|------|
| [PLUGIN_SYSTEM_QUICK_REF.md](PLUGIN_SYSTEM_QUICK_REF.md) | 快速参考 | 5分钟上手 |
| [PLUGIN_SYSTEM_GUIDE.md](PLUGIN_SYSTEM_GUIDE.md) | 完整指南 | 深入学习 |
| [PLUGIN_SYSTEM_SUMMARY.md](PLUGIN_SYSTEM_SUMMARY.md) | 实现总结 | 了解架构 |
| [examples/plugin-system-example.ts](examples/plugin-system-example.ts) | 代码示例 | 实践学习 |

---

## 💡 最佳实践

### ✅ 推荐

1. **职责单一**：每个插件只做一件事
2. **优雅降级**：错误时返回原始数据而不是中断
3. **异步优先**：所有钩子都是异步的
4. **事件通信**：插件间使用事件而不是直接调用
5. **配置驱动**：通过配置控制功能而不是代码

### ❌ 避免

1. **循环依赖**：A依赖B，B依赖A
2. **阻塞操作**：在钩子中执行长时间同步操作
3. **全局状态**：使用插件上下文而不是全局变量
4. **异常泄漏**：捕获并处理所有异常
5. **资源泄漏**：在 onUnload 中清理所有资源

---

## 🎉 总结

插件系统已完全实现并集成到 SBot：

- ✅ 完整的插件架构（EventBus + PluginManager + IPlugin）
- ✅ 内置 MemoryPlugin 作为示范
- ✅ 配置文件集成
- ✅ 完整的文档和示例
- ✅ TypeScript 编译通过，生产就绪

**立即开始使用插件系统，让 SBot 更加灵活和强大！** 🚀

---

## 🤝 贡献

欢迎贡献新插件！步骤：

1. 创建插件类（继承 `BasePlugin`）
2. 实现所需的钩子方法
3. 添加配置支持
4. 编写测试和文档
5. 提交 Pull Request

---

## 📝 许可证

[MIT License](LICENSE)
