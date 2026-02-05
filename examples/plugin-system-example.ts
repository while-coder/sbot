/**
 * 插件系统使用示例
 *
 * 本文件展示如何使用 SBot 的插件系统：
 * 1. 注册和使用内置插件（MemoryPlugin）
 * 2. 创建自定义插件
 * 3. 插件间通信（事件）
 * 4. 插件配置管理
 */

import {
  PluginManager,
  globalPluginManager,
  EventBus,
  globalEventBus,
  BasePlugin,
  PluginMetadata,
  PluginContext,
  MemoryPlugin,
  registerCorePlugins,
  unregisterAllPlugins
} from "../src/Plugin";
import { MemoryType } from "../src/Memory/types";
import { config } from "../src/Config";

// ============================================
// 示例1：使用内置 MemoryPlugin
// ============================================

async function example1_UseMemoryPlugin() {
  console.log("\n=== 示例1：使用 MemoryPlugin ===\n");

  // 1. 注册核心插件（包括 MemoryPlugin）
  await registerCorePlugins(globalPluginManager);

  // 2. 获取 MemoryPlugin 实例
  const memoryPlugin = globalPluginManager.getPlugin("MemoryPlugin") as MemoryPlugin;

  if (!memoryPlugin) {
    console.log("MemoryPlugin 未注册或未加载");
    return;
  }

  // 3. 使用 MemoryPlugin API
  // 添加记忆
  const memoryId = await memoryPlugin.addMemory(
    "我喜欢吃披萨和意大利面",
    MemoryType.SEMANTIC,
    0.8,
    { category: "preferences" }
  );
  console.log(`记忆已添加 - ID: ${memoryId}`);

  // 检索记忆
  const memories = await memoryPlugin.retrieveMemories("用户喜欢什么食物？", 5);
  console.log(`检索到 ${memories.length} 条相关记忆：`);
  memories.forEach((mem, idx) => {
    console.log(`  ${idx + 1}. ${mem.content}`);
  });

  // 获取统计信息
  const stats = await memoryPlugin.getStatistics();
  console.log("\n记忆统计：", stats);
}

// ============================================
// 示例2：创建自定义插件
// ============================================

/**
 * 自定义插件示例：查询日志插件
 */
class QueryLogPlugin extends BasePlugin {
  metadata: PluginMetadata = {
    name: "QueryLogPlugin",
    version: "1.0.0",
    description: "记录所有用户查询到日志文件",
    author: "SBot Team"
  };

  private queryCount = 0;
  private queries: string[] = [];

  async onLoad(context: PluginContext): Promise<void> {
    await super.onLoad(context);
    this.context?.logger.info("QueryLogPlugin 已加载");
  }

  async onBeforeQuery(query: string, context: any): Promise<string> {
    this.queryCount++;
    this.queries.push(query);

    this.context?.logger.info(`查询 #${this.queryCount}: ${query}`);

    // 发送事件
    this.emit("query:logged", {
      count: this.queryCount,
      query,
      timestamp: Date.now()
    });

    // 返回原始查询（不修改）
    return query;
  }

  // 公开 API
  getQueryCount(): number {
    return this.queryCount;
  }

  getRecentQueries(limit: number = 10): string[] {
    return this.queries.slice(-limit);
  }
}

async function example2_CustomPlugin() {
  console.log("\n=== 示例2：创建自定义插件 ===\n");

  const pluginManager = new PluginManager();

  // 1. 创建并注册自定义插件
  const queryLogPlugin = new QueryLogPlugin();
  await pluginManager.register(queryLogPlugin, {
    enabled: true,
    priority: 5
  });

  // 2. 监听插件事件
  globalEventBus.on("query:logged", (data: any) => {
    console.log(`[事件] 查询已记录 - 总数: ${data.count}`);
  });

  // 3. 执行钩子（模拟查询）
  const queries = ["你好", "今天天气如何？", "帮我写一段代码"];

  for (const query of queries) {
    await pluginManager.executeHook("onBeforeQuery", query, {});
  }

  // 4. 使用插件 API
  console.log(`\n总查询数: ${queryLogPlugin.getQueryCount()}`);
  console.log("最近的查询：");
  queryLogPlugin.getRecentQueries().forEach((q, idx) => {
    console.log(`  ${idx + 1}. ${q}`);
  });

  // 5. 卸载插件
  await pluginManager.unregister("QueryLogPlugin");
}

// ============================================
// 示例3：插件间通信
// ============================================

/**
 * 插件 A：发送事件
 */
class SenderPlugin extends BasePlugin {
  metadata: PluginMetadata = {
    name: "SenderPlugin",
    version: "1.0.0",
    description: "发送事件的插件"
  };

  async onLoad(context: PluginContext): Promise<void> {
    await super.onLoad(context);

    // 定时发送事件
    setInterval(() => {
      this.emit("data:updated", {
        timestamp: Date.now(),
        value: Math.random()
      });
    }, 2000);
  }
}

/**
 * 插件 B：接收事件
 */
class ReceiverPlugin extends BasePlugin {
  metadata: PluginMetadata = {
    name: "ReceiverPlugin",
    version: "1.0.0",
    description: "接收事件的插件"
  };

  async onLoad(context: PluginContext): Promise<void> {
    await super.onLoad(context);

    // 监听事件
    this.on("data:updated", (data: any) => {
      this.context?.logger.info(`收到数据更新: ${data.value}`);
    });
  }
}

async function example3_PluginCommunication() {
  console.log("\n=== 示例3：插件间通信 ===\n");

  const pluginManager = new PluginManager();

  // 注册两个插件
  await pluginManager.register(new SenderPlugin(), { enabled: true });
  await pluginManager.register(new ReceiverPlugin(), { enabled: true });

  console.log("插件已注册，等待事件...");

  // 等待几秒观察事件
  await new Promise(resolve => setTimeout(resolve, 5000));

  // 卸载插件
  await pluginManager.unloadAll();
}

// ============================================
// 示例4：插件依赖
// ============================================

/**
 * 基础服务插件
 */
class DataServicePlugin extends BasePlugin {
  metadata: PluginMetadata = {
    name: "DataServicePlugin",
    version: "1.0.0",
    description: "提供数据服务"
  };

  getData(): string {
    return "来自 DataServicePlugin 的数据";
  }
}

/**
 * 依赖基础服务的插件
 */
class AnalyticsPlugin extends BasePlugin {
  metadata: PluginMetadata = {
    name: "AnalyticsPlugin",
    version: "1.0.0",
    description: "数据分析插件",
    dependencies: ["DataServicePlugin"] // 声明依赖
  };

  private dataService?: DataServicePlugin;

  async onLoad(context: PluginContext): Promise<void> {
    await super.onLoad(context);

    // 获取依赖的插件
    this.dataService = context.getPlugin?.("DataServicePlugin") as DataServicePlugin;

    if (!this.dataService) {
      throw new Error("依赖的 DataServicePlugin 未找到");
    }

    this.context?.logger.info("AnalyticsPlugin 已加载，依赖已解析");
  }

  analyze(): void {
    if (this.dataService) {
      const data = this.dataService.getData();
      this.context?.logger.info(`分析数据: ${data}`);
    }
  }
}

async function example4_PluginDependencies() {
  console.log("\n=== 示例4：插件依赖 ===\n");

  const pluginManager = new PluginManager();

  // 1. 先注册基础服务插件
  await pluginManager.register(new DataServicePlugin(), { enabled: true });

  // 2. 再注册依赖它的插件
  await pluginManager.register(new AnalyticsPlugin(), {
    enabled: true,
    priority: 20 // 优先级低于基础服务
  });

  // 3. 使用插件
  const analyticsPlugin = pluginManager.getPlugin("AnalyticsPlugin") as AnalyticsPlugin;
  analyticsPlugin?.analyze();

  // 4. 调试信息
  pluginManager.debug();

  // 5. 卸载插件
  await pluginManager.unloadAll();
}

// ============================================
// 示例5：钩子链
// ============================================

/**
 * 插件1：过滤敏感词
 */
class FilterPlugin extends BasePlugin {
  metadata: PluginMetadata = {
    name: "FilterPlugin",
    version: "1.0.0",
    description: "过滤敏感词"
  };

  async onBeforeQuery(query: string, context: any): Promise<string> {
    // 过滤敏感词
    let filtered = query.replace(/敏感词/g, "***");
    this.context?.logger.info(`FilterPlugin: ${query} -> ${filtered}`);
    return filtered;
  }
}

/**
 * 插件2：添加前缀
 */
class PrefixPlugin extends BasePlugin {
  metadata: PluginMetadata = {
    name: "PrefixPlugin",
    version: "1.0.0",
    description: "添加查询前缀"
  };

  async onBeforeQuery(query: string, context: any): Promise<string> {
    const prefixed = `[用户查询] ${query}`;
    this.context?.logger.info(`PrefixPlugin: ${query} -> ${prefixed}`);
    return prefixed;
  }
}

async function example5_HookChaining() {
  console.log("\n=== 示例5：钩子链 ===\n");

  const pluginManager = new PluginManager();

  // 注册插件（按优先级执行）
  await pluginManager.register(new FilterPlugin(), {
    enabled: true,
    priority: 10 // 先执行
  });

  await pluginManager.register(new PrefixPlugin(), {
    enabled: true,
    priority: 20 // 后执行
  });

  // 执行钩子链
  const originalQuery = "这是一个包含敏感词的查询";
  console.log(`原始查询: ${originalQuery}`);

  const result = await pluginManager.executeHook(
    "onBeforeQuery",
    originalQuery,
    {}
  );

  console.log(`最终结果: ${result}`);

  // 卸载插件
  await pluginManager.unloadAll();
}

// ============================================
// 主函数：运行所有示例
// ============================================

async function main() {
  console.log("========================================");
  console.log("       SBot 插件系统示例");
  console.log("========================================");

  try {
    // await example1_UseMemoryPlugin();
    await example2_CustomPlugin();
    // await example3_PluginCommunication();
    await example4_PluginDependencies();
    await example5_HookChaining();

    console.log("\n========================================");
    console.log("       所有示例运行完成！");
    console.log("========================================\n");
  } catch (error: any) {
    console.error("示例运行失败:", error.message);
    console.error(error.stack);
  }
}

// 运行示例
if (require.main === module) {
  main().catch(console.error);
}

export {
  example1_UseMemoryPlugin,
  example2_CustomPlugin,
  example3_PluginCommunication,
  example4_PluginDependencies,
  example5_HookChaining
};
