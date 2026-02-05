# 插件系统快速参考

## 🚀 5分钟上手

### 1. 创建插件

```typescript
import { BasePlugin, PluginMetadata, PluginContext } from "./src/Plugin";

export class MyPlugin extends BasePlugin {
  metadata: PluginMetadata = {
    name: "MyPlugin",
    version: "1.0.0",
    description: "我的插件"
  };

  async onLoad(context: PluginContext): Promise<void> {
    await super.onLoad(context);
    this.context?.logger.info("插件已加载");
  }

  async onBeforeQuery(query: string, context: any): Promise<string> {
    // 处理查询
    return query;
  }
}
```

### 2. 注册插件

```typescript
import { globalPluginManager } from "./src/Plugin";

await globalPluginManager.register(new MyPlugin(), {
  enabled: true,
  priority: 10
});
```

### 3. 配置插件

在 `~/.sbot/settings.toml` 中：

```toml
[plugins.MyPlugin]
enabled = true
priority = 10

[plugins.MyPlugin.config]
option1 = "value1"
```

---

## 📚 常用API

### 插件钩子

```typescript
// 查询前处理
async onBeforeQuery(query: string, context: any): Promise<string>

// 响应后处理
async onAfterResponse(response: string, query: string, context: any): Promise<string>

// 消息处理
async onMessage(message: AgentMessage, context: any): Promise<AgentMessage>

// 工具调用前后
async onBeforeToolCall(toolName: string, args: any, context: any): Promise<void>
async onAfterToolCall(toolName: string, result: any, context: any): Promise<void>

// 生命周期
async onLoad(context: PluginContext): Promise<void>
async onUnload(): Promise<void>

// 错误处理
async onError(error: Error, context: any): Promise<void>
```

### 插件管理

```typescript
// 注册
await manager.register(plugin, { enabled: true, priority: 10 });

// 加载/卸载
await manager.load("PluginName");
await manager.unload("PluginName");

// 启用/禁用
await manager.enable("PluginName");
await manager.disable("PluginName");

// 获取插件
const plugin = manager.getPlugin("PluginName");

// 执行钩子
const result = await manager.executeHook("onBeforeQuery", data, {});
```

### 事件通信

```typescript
// 发送事件（在插件中）
this.emit("event:name", { data });

// 监听事件（在插件中）
this.on("event:name", (data) => {
  console.log(data);
});

// 全局事件总线
import { globalEventBus } from "./src/Plugin";
globalEventBus.emit("event", data);
globalEventBus.on("event", handler);
```

---

## 🎯 内置插件

### MemoryPlugin

长期记忆插件，支持自动记忆和检索。

**配置：**

```toml
[plugins.MemoryPlugin]
enabled = true
priority = 10

[plugins.MemoryPlugin.config]
dbPath = "memory.db"
autoMemorize = true          # 自动记忆对话
autoRetrieve = true          # 自动检索记忆
retrievalLimit = 5           # 检索数量
enableLLMEvaluation = true   # LLM 评估重要性
enableCompression = true     # 启用压缩

[plugins.MemoryPlugin.config.embeddingConfig]
apiKey = "your-api-key"
baseURL = "https://api.openai.com/v1"
model = "text-embedding-ada-002"
```

**使用：**

```typescript
import { MemoryPlugin } from "./src/Plugin";

const plugin = globalPluginManager.getPlugin("MemoryPlugin") as MemoryPlugin;

// 添加记忆
await plugin.addMemory("内容", MemoryType.SEMANTIC, 0.8);

// 检索记忆
const memories = await plugin.retrieveMemories("查询", 5);

// 获取统计
const stats = await plugin.getStatistics();
```

**命令：**

```
/memory stats           # 获取统计信息
/memory search 关键词   # 搜索记忆
/memory compress        # 压缩记忆
```

---

## 💡 常见模式

### 模式1：修改查询

```typescript
async onBeforeQuery(query: string, context: any): Promise<string> {
  // 添加上下文
  return `[系统] ${query}`;
}
```

### 模式2：记录日志

```typescript
async onBeforeQuery(query: string, context: any): Promise<string> {
  this.context?.logger.info(`查询: ${query}`);
  return query; // 不修改查询
}
```

### 模式3：插件通信

```typescript
// 插件A：发送事件
this.emit("data:updated", { value: 123 });

// 插件B：接收事件
async onLoad(context: PluginContext): Promise<void> {
  await super.onLoad(context);
  this.on("data:updated", (data) => {
    console.log(data.value);
  });
}
```

### 模式4：依赖其他插件

```typescript
export class MyPlugin extends BasePlugin {
  metadata: PluginMetadata = {
    name: "MyPlugin",
    version: "1.0.0",
    description: "我的插件",
    dependencies: ["OtherPlugin"]  // 声明依赖
  };

  private otherPlugin?: OtherPlugin;

  async onLoad(context: PluginContext): Promise<void> {
    await super.onLoad(context);

    // 获取依赖的插件
    this.otherPlugin = context.getPlugin?.("OtherPlugin") as OtherPlugin;
  }
}
```

---

## 🔧 优先级

| 范围 | 用途 | 示例 |
|------|------|------|
| 0-9 | 系统级预处理 | 输入过滤 |
| 10-49 | 核心功能 | 记忆、分析 |
| 50-99 | 增强功能 | 翻译、总结 |
| 100+ | 后处理 | 日志、统计 |

---

## ⚠️ 注意事项

### 1. 错误处理

```typescript
async onBeforeQuery(query: string, context: any): Promise<string> {
  try {
    return await this.process(query);
  } catch (error: any) {
    this.context?.logger.error(`处理失败: ${error.message}`);
    return query; // 返回原始数据
  }
}
```

### 2. 资源清理

```typescript
async onLoad(context: PluginContext): Promise<void> {
  await super.onLoad(context);
  this.timer = setInterval(() => {}, 1000);
}

async onUnload(): Promise<void> {
  if (this.timer) {
    clearInterval(this.timer);
  }
  await super.onUnload();
}
```

### 3. 避免循环依赖

```typescript
// ❌ 错误
PluginA.dependencies = ["PluginB"];
PluginB.dependencies = ["PluginA"];

// ✅ 正确
PluginA.dependencies = ["SharedService"];
PluginB.dependencies = ["SharedService"];
```

---

## 📖 完整文档

- [PLUGIN_SYSTEM_GUIDE.md](PLUGIN_SYSTEM_GUIDE.md) - 详细指南
- [PLUGIN_SYSTEM_SUMMARY.md](PLUGIN_SYSTEM_SUMMARY.md) - 实现总结
- [examples/plugin-system-example.ts](examples/plugin-system-example.ts) - 示例代码

---

**快速开始，立即使用！** 🚀
