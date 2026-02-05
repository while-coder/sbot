/**
 * 长期记忆功能使用示例
 *
 * 运行方式：
 * npx ts-node examples/memory-example.ts
 */

import { MemoryService, MemoryType } from "../src/Memory";
import path from "path";

async function main() {
  console.log("=== SBot 长期记忆功能示例 ===\n");

  // 1. 初始化记忆服务
  console.log("1. 初始化记忆服务...");
  const memoryService = new MemoryService({
    userId: "test_user_123",
    dbPath: path.join(__dirname, "../test_memory.db"),
    embeddingConfig: {
      apiKey: process.env.OPENAI_API_KEY || "your-api-key",
      baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      model: "text-embedding-ada-002"
    },
    enableAutoCleanup: false,  // 测试时禁用自动清理
    maxMemoryAgeDays: 90
  });
  console.log("✓ 记忆服务已初始化\n");

  // 2. 添加一些测试记忆
  console.log("2. 添加测试记忆...");

  const memory1 = await memoryService.addMemory(
    "用户喜欢使用 TypeScript 开发项目",
    MemoryType.SEMANTIC,
    0.9
  );
  console.log(`✓ 添加记忆: ${memory1}`);

  const memory2 = await memoryService.addMemory(
    "用户的主要工作是Web前端开发",
    MemoryType.SEMANTIC,
    0.8
  );
  console.log(`✓ 添加记忆: ${memory2}`);

  const memory3 = await memoryService.addMemory(
    "用户问：如何在React中使用Hooks？",
    MemoryType.EPISODIC,
    0.6
  );
  console.log(`✓ 添加记忆: ${memory3}\n`);

  // 3. 批量添加记忆
  console.log("3. 批量添加记忆...");
  const batchIds = await memoryService.batchAddMemories([
    {
      content: "用户喜欢使用 VSCode 作为编辑器",
      type: MemoryType.SEMANTIC,
      importance: 0.7
    },
    {
      content: "用户的项目名称是 MyAwesomeApp",
      type: MemoryType.SEMANTIC,
      importance: 0.8
    },
    {
      content: "用户使用 React 18 和 Next.js 13",
      type: MemoryType.SEMANTIC,
      importance: 0.9
    }
  ]);
  console.log(`✓ 批量添加了 ${batchIds.length} 条记忆\n`);

  // 4. 检索相关记忆
  console.log("4. 检索相关记忆...");

  console.log("\n查询：用户使用什么编程语言？");
  const result1 = await memoryService.retrieveRelevantMemories(
    "用户使用什么编程语言？",
    { limit: 3, useTimeDecay: false }
  );
  console.log(`找到 ${result1.length} 条相关记忆：`);
  result1.forEach((memory, index) => {
    console.log(`  ${index + 1}. [${memory.type}] ${memory.content}`);
    console.log(`     重要性: ${memory.metadata.importance.toFixed(2)}`);
  });

  console.log("\n查询：用户的开发工具是什么？");
  const result2 = await memoryService.retrieveRelevantMemories(
    "用户的开发工具",
    { limit: 3, useTimeDecay: true }
  );
  console.log(`找到 ${result2.length} 条相关记忆：`);
  result2.forEach((memory, index) => {
    console.log(`  ${index + 1}. [${memory.type}] ${memory.content}`);
  });

  console.log("\n查询：React相关的记忆");
  const result3 = await memoryService.retrieveRelevantMemories(
    "React开发",
    {
      limit: 3,
      useTimeDecay: true,
      keywords: ["React"]
    }
  );
  console.log(`找到 ${result3.length} 条相关记忆：`);
  result3.forEach((memory, index) => {
    console.log(`  ${index + 1}. [${memory.type}] ${memory.content}`);
  });

  // 5. 获取记忆摘要
  console.log("\n5. 获取记忆摘要（用于注入到提示词）...");
  const summary = await memoryService.getMemorySummary(
    "用户的技术栈和偏好",
    300
  );
  console.log("摘要内容：");
  console.log(summary);

  // 6. 获取统计信息
  console.log("\n6. 记忆统计信息...");
  const stats = memoryService.getStatistics();
  console.log(`总记忆数: ${stats.totalCount}`);
  console.log(`情节记忆: ${stats.byType[MemoryType.EPISODIC] || 0}`);
  console.log(`语义记忆: ${stats.byType[MemoryType.SEMANTIC] || 0}`);
  console.log(`平均重要性: ${stats.avgImportance.toFixed(2)}`);
  console.log(`最早记忆: ${new Date(stats.oldestMemory).toLocaleString()}`);
  console.log(`最新记忆: ${new Date(stats.newestMemory).toLocaleString()}`);

  // 7. 保存对话记忆
  console.log("\n7. 保存对话记忆...");
  await memoryService.memorizeConversation(
    "如何在TypeScript中使用泛型？",
    "在 TypeScript 中，泛型允许你创建可重用的组件..."
  );
  console.log("✓ 对话已保存");

  // 8. 清理（可选）
  console.log("\n8. 清理测试记忆...");
  const deleted = memoryService.clearAllMemories();
  console.log(`✓ 已清理 ${deleted} 条记忆`);

  // 9. 释放资源
  memoryService.dispose();
  console.log("\n✓ 记忆服务已关闭");

  console.log("\n=== 示例完成 ===");
}

// 运行示例
main().catch(error => {
  console.error("错误:", error);
  process.exit(1);
});
