/**
 * 长期记忆高级功能示例
 * LLM 驱动的重要性评估和记忆压缩
 *
 * 运行方式：
 * npx ts-node examples/memory-advanced-example.ts
 */

import { MemoryService, MemoryType, MergeStrategy } from "../src/Memory";
import path from "path";

async function main() {
  console.log("=== SBot 长期记忆高级功能示例 ===\n");

  // 1. 初始化记忆服务（启用高级功能）
  console.log("1. 初始化记忆服务（启用 LLM 评估和压缩）...");
  const memoryService = new MemoryService({
    userId: "advanced_test_user",
    dbPath: path.join(__dirname, "../test_memory_advanced.db"),
    embeddingConfig: {
      apiKey: process.env.OPENAI_API_KEY || "your-api-key",
      baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      model: "text-embedding-ada-002"
    },
    enableAutoCleanup: false,
    maxMemoryAgeDays: 90,
    enableLLMEvaluation: true,    // 启用 LLM 重要性评估
    enableCompression: true,       // 启用记忆压缩
    compressionModel: "gpt-3.5-turbo"
  });
  console.log("✓ 记忆服务已初始化（高级功能已启用）\n");

  // 2. 使用 LLM 自动评估重要性
  console.log("2. 使用 LLM 自动评估记忆重要性...");

  const testContents = [
    "用户今天天气不错随口说了一句",
    "用户的生日是1990年1月1日，这是非常重要的个人信息",
    "用户决定在项目中使用 React 和 TypeScript 技术栈",
    "用户喜欢喝咖啡",
    "用户的主要联系邮箱是 user@example.com，务必记住"
  ];

  console.log("\n添加记忆并让 LLM 自动评估重要性：");
  const memoryIds: string[] = [];

  for (const content of testContents) {
    const memoryId = await memoryService.addMemory(
      content,
      MemoryType.SEMANTIC,
      undefined, // 不提供重要性，让 LLM 自动评估
      {},
      true // 启用 LLM 评估
    );
    memoryIds.push(memoryId);
    console.log(`✓ 添加: ${content.substring(0, 50)}...`);
  }

  // 等待一下让评估完成
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 3. 查看 LLM 评估结果
  console.log("\n3. 查看 LLM 评估的重要性...");
  const evaluator = memoryService.getImportanceEvaluator();

  if (evaluator) {
    for (let i = 0; i < testContents.length; i++) {
      const evaluation = await evaluator.evaluate(testContents[i]);
      console.log(`\n内容: ${testContents[i]}`);
      console.log(`重要性: ${evaluation.score.toFixed(2)}`);
      console.log(`类别: ${evaluation.category}`);
      console.log(`理由: ${evaluation.reasoning}`);
      if (evaluation.tags && evaluation.tags.length > 0) {
        console.log(`标签: ${evaluation.tags.join(', ')}`);
      }
    }
  }

  // 4. 批量评估
  console.log("\n4. 批量评估多个记忆的重要性...");
  if (evaluator) {
    const batchItems = [
      { content: "用户问了一个关于 JavaScript 的简单问题" },
      { content: "用户的密码是 secret123，这是机密信息" },
      { content: "用户说今天吃了午饭" }
    ];

    const batchResults = await evaluator.evaluateBatch(batchItems);
    batchResults.forEach((result, index) => {
      console.log(`\n[${index + 1}] ${batchItems[index].content}`);
      console.log(`    重要性: ${result.score.toFixed(2)} - ${result.reasoning}`);
    });
  }

  // 5. 记忆压缩示例
  console.log("\n5. 记忆压缩功能...");

  // 添加一些相关的记忆用于压缩
  console.log("\n添加相关记忆用于压缩测试：");
  const relatedMemories = [
    "用户使用 React 开发前端应用",
    "用户在项目中使用 React Hooks",
    "用户喜欢 React 的组件化开发方式",
    "用户的 React 项目使用 TypeScript"
  ];

  const compressIds: string[] = [];
  for (const content of relatedMemories) {
    const id = await memoryService.addMemory(
      content,
      MemoryType.SEMANTIC,
      0.7,
      {},
      false // 不使用 LLM 评估以节省时间
    );
    compressIds.push(id);
    console.log(`✓ 添加: ${content}`);
  }

  // 压缩这些相关记忆
  console.log("\n压缩相关记忆：");
  const compressionResult = await memoryService.compressSpecificMemories(
    compressIds,
    MergeStrategy.THEMATIC
  );

  if (compressionResult) {
    console.log(`\n✓ 压缩成功！`);
    console.log(`原始记忆数: ${compressionResult.sourceMemoryIds.length}`);
    console.log(`压缩后内容: ${compressionResult.compressedMemory.content}`);
    console.log(`压缩比: ${(compressionResult.compressionRatio * 100).toFixed(1)}%`);
    console.log(`摘要: ${compressionResult.summary}`);
  }

  // 6. 获取统计信息
  console.log("\n6. 记忆统计信息...");
  const stats = memoryService.getStatistics();
  console.log(`总记忆数: ${stats.totalCount}`);
  console.log(`语义记忆: ${stats.byType[MemoryType.SEMANTIC] || 0}`);
  console.log(`平均重要性: ${stats.avgImportance.toFixed(2)}`);

  // 7. 清理
  console.log("\n7. 清理测试数据...");
  const deleted = memoryService.clearAllMemories();
  console.log(`✓ 已清理 ${deleted} 条记忆`);

  // 8. 释放资源
  memoryService.dispose();
  console.log("\n✓ 记忆服务已关闭");

  console.log("\n=== 高级功能示例完成 ===");
  console.log("\n重要提示：");
  console.log("- LLM 评估需要 API 调用，会产生少量费用");
  console.log("- 建议在生产环境中根据需求选择性启用");
  console.log("- 启发式评估（默认）对大多数场景已经足够");
}

// 运行示例
main().catch(error => {
  console.error("错误:", error);
  process.exit(1);
});
