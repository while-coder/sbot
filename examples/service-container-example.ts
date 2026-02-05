/**
 * 服务容器使用示例
 * 演示如何使用服务容器管理应用程序服务
 *
 * 运行方式：
 * npx ts-node examples/service-container-example.ts
 */

import { ServiceContainer, globalContainer, registerCoreServices } from "../src/Core";
import { ImportanceEvaluatorService } from "../src/Memory/Services/ImportanceEvaluatorService";
import { MemoryCompressorService } from "../src/Memory/Services/MemoryCompressorService";

async function main() {
  console.log("=== 服务容器使用示例 ===\n");

  // ============================================
  // 1. 创建并配置根容器
  // ============================================
  console.log("1. 创建服务容器...");
  const container = new ServiceContainer("app");

  // 手动注册服务
  container.addSingleton(
    "ImportanceEvaluatorService",
    ImportanceEvaluatorService,
    {
      enabled: true,
      config: {
        apiKey: process.env.OPENAI_API_KEY || "your-api-key",
        baseURL: "https://api.openai.com/v1",
        model: "gpt-3.5-turbo",
        enabled: true
      }
    }
  );

  container.addSingleton(
    "MemoryCompressorService",
    MemoryCompressorService,
    {
      enabled: true,
      config: {
        apiKey: process.env.OPENAI_API_KEY || "your-api-key",
        baseURL: "https://api.openai.com/v1",
        model: "gpt-3.5-turbo",
        enabled: true
      }
    }
  );

  console.log("✓ 服务容器已创建\n");

  // ============================================
  // 2. 获取并使用服务
  // ============================================
  console.log("2. 获取服务实例...");

  const evaluatorService = await container.get<ImportanceEvaluatorService>(
    "ImportanceEvaluatorService"
  );
  console.log(`✓ 获取到: ${evaluatorService.serviceName}`);

  const compressorService = await container.get<MemoryCompressorService>(
    "MemoryCompressorService"
  );
  console.log(`✓ 获取到: ${compressorService.serviceName}\n`);

  // ============================================
  // 3. 使用服务
  // ============================================
  console.log("3. 使用重要性评估服务...");

  if (evaluatorService.isEnabled()) {
    const evaluation = await evaluatorService.evaluate(
      "用户的生日是1990年1月1日，这是重要的个人信息"
    );

    if (evaluation) {
      console.log(`评估结果:`);
      console.log(`  重要性分数: ${evaluation.score.toFixed(2)}`);
      console.log(`  类别: ${evaluation.category}`);
      console.log(`  理由: ${evaluation.reasoning}`);
      if (evaluation.tags) {
        console.log(`  标签: ${evaluation.tags.join(", ")}`);
      }
    }
  }

  // ============================================
  // 4. 创建作用域容器
  // ============================================
  console.log("\n4. 创建作用域容器（用户会话）...");

  const userScope1 = container.createScope("user-123");
  const userScope2 = container.createScope("user-456");

  console.log("✓ 创建了两个用户作用域\n");

  // ============================================
  // 5. 在作用域中使用服务
  // ============================================
  console.log("5. 在作用域中获取服务...");

  // 单例服务在所有作用域中共享
  const evaluatorInScope1 = await userScope1.get<ImportanceEvaluatorService>(
    "ImportanceEvaluatorService"
  );

  const evaluatorInScope2 = await userScope2.get<ImportanceEvaluatorService>(
    "ImportanceEvaluatorService"
  );

  console.log(`作用域1中的评估服务 === 作用域2中的评估服务: ${
    evaluatorInScope1 === evaluatorInScope2
  }`);
  console.log("（因为是单例，所以相同）\n");

  // ============================================
  // 6. 查看容器信息
  // ============================================
  console.log("6. 容器调试信息:");
  container.debug();

  // ============================================
  // 7. 检查服务是否存在
  // ============================================
  console.log("7. 检查服务...");
  console.log(`ImportanceEvaluatorService 存在: ${container.has("ImportanceEvaluatorService")}`);
  console.log(`MemoryCompressorService 存在: ${container.has("MemoryCompressorService")}`);
  console.log(`NonExistentService 存在: ${container.has("NonExistentService")}\n`);

  // ============================================
  // 8. 尝试获取不存在的服务
  // ============================================
  console.log("8. 尝试获取不存在的服务...");
  const maybeService = await container.tryGet("NonExistentService");
  console.log(`结果: ${maybeService === null ? "null（服务不存在）" : "获取成功"}\n`);

  // ============================================
  // 9. 列出所有服务
  // ============================================
  console.log("9. 所有已注册的服务:");
  const serviceNames = container.getServiceNames();
  serviceNames.forEach(name => {
    console.log(`  • ${name}`);
  });

  // ============================================
  // 10. 释放资源
  // ============================================
  console.log("\n10. 释放资源...");
  await userScope1.dispose();
  await userScope2.dispose();
  await container.dispose();
  console.log("✓ 所有资源已释放");

  console.log("\n=== 示例完成 ===");

  // ============================================
  // 使用全局容器的示例
  // ============================================
  console.log("\n=== 使用全局容器 ===\n");

  // 注册核心服务到全局容器
  // registerCoreServices(globalContainer);

  // 从全局容器获取服务
  // const globalEvaluator = await globalContainer.get<ImportanceEvaluatorService>(
  //   "ImportanceEvaluatorService"
  // );

  console.log("全局容器已准备就绪，可以在应用程序中使用");
}

// 运行示例
main().catch(error => {
  console.error("错误:", error);
  process.exit(1);
});
