/**
 * Embedding 配置使用示例
 * 展示如何使用 Config 中的 embeddings 配置
 */

import { config } from "../src/Config";
import { EmbeddingServiceFactory } from "../src/Embedding";

async function main() {
    console.log("🔧 Embedding 配置示例\n");

    // ============================================================
    // 示例 1: 获取当前 embedding 配置
    // ============================================================
    console.log("📋 [示例 1] 从配置文件读取 embedding\n");

    const currentEmbeddingName = config.getEmbeddingName();
    console.log(`  当前选中的 embedding: ${currentEmbeddingName}`);

    const currentEmbedding = config.getCurrentEmbedding();
    if (currentEmbedding) {
        console.log(`  ✅ 找到配置:`);
        console.log(`     Provider: ${currentEmbedding.provider}`);
        console.log(`     Model: ${currentEmbedding.model}`);
        console.log(`     BaseURL: ${currentEmbedding.baseURL}`);
        console.log(`     API Key: ${currentEmbedding.apiKey?.substring(0, 10)}...`);
    } else {
        console.log(`  ❌ 未找到 embedding 配置`);
        console.log(`  请在 ~/.sbot/settings.toml 中配置 [embeddings.${currentEmbeddingName}]`);
        return;
    }

    console.log();

    // ============================================================
    // 示例 2: 使用配置创建 embedding 服务
    // ============================================================
    console.log("🏭 [示例 2] 使用配置创建 embedding 服务（静态方法）\n");

    const embeddingService = await EmbeddingServiceFactory.getEmbeddingService(currentEmbeddingName);

    console.log("  ✅ Embedding 服务创建成功\n");

    // 生成 embedding
    console.log("  📝 生成 embedding...");
    const text = "Hello, world!";
    const embedding = await embeddingService.embedQuery(text);
    console.log(`  ✅ 为文本 "${text}" 生成了 ${embedding.length} 维的向量\n`);

    // ============================================================
    // 示例 3: 切换不同的 embedding 配置
    // ============================================================
    console.log("🔄 [示例 3] 获取所有可用的 embedding 配置\n");

    const settings = config.settings;
    if (settings.embeddings) {
        const embeddingNames = Object.keys(settings.embeddings);
        console.log(`  可用的 embedding 配置: ${embeddingNames.length} 个\n`);

        for (const name of embeddingNames) {
            const embConfig = config.getEmbedding(name);
            if (embConfig) {
                console.log(`  📦 ${name}`);
                console.log(`     Provider: ${embConfig.provider}`);
                console.log(`     Model: ${embConfig.model}`);
                console.log(`     BaseURL: ${embConfig.baseURL}`);
            }
        }
    } else {
        console.log("  ❌ 未配置任何 embedding");
    }

    console.log();

    // ============================================================
    // 示例 4: 使用指定的 embedding
    // ============================================================
    console.log("🎯 [示例 4] 使用指定名称的 embedding\n");

    // 假设配置中有 "openai-3-small"
    const specificEmbeddingName = "openai-3-small";
    const specificEmbedding = config.getEmbedding(specificEmbeddingName);
    if (specificEmbedding) {
        console.log(`  ✅ 找到指定的 embedding: ${specificEmbeddingName}`);
        console.log(`     Model: ${specificEmbedding.model}\n`);

        // 创建该 embedding 服务（使用静态方法，传入名称）
        const specificService = await EmbeddingServiceFactory.getEmbeddingService(specificEmbeddingName);
        const embedding2 = await specificService.embedQuery("Test text");
        console.log(`  ✅ 使用 ${specificEmbeddingName} 生成了 ${embedding2.length} 维的向量\n`);
    } else {
        console.log(`  ℹ️  未找到 ${specificEmbeddingName} 配置\n`);
    }

    // ============================================================
    // 示例 5: 配置文件格式说明
    // ============================================================
    console.log("📄 [示例 5] 配置文件格式说明\n");

    console.log(`  在 ~/.sbot/settings.toml 中配置：\n`);
    console.log(`  # 当前使用的 embedding 名称`);
    console.log(`  embedding = "openai-ada"\n`);
    console.log(`  # Embedding 配置`);
    console.log(`  [embeddings.openai-ada]`);
    console.log(`  provider = "openai"`);
    console.log(`  apiKey = "your-api-key"`);
    console.log(`  baseURL = "https://api.openai.com/v1"`);
    console.log(`  model = "text-embedding-ada-002"\n`);
    console.log(`  [embeddings.openai-3-small]`);
    console.log(`  provider = "openai"`);
    console.log(`  apiKey = "your-api-key"`);
    console.log(`  baseURL = "https://api.openai.com/v1"`);
    console.log(`  model = "text-embedding-3-small"\n`);

    // 清理缓存（使用静态方法）
    await EmbeddingServiceFactory.clearCache();
    console.log("✨ 示例完成！");
}

// 运行示例
if (require.main === module) {
    main().catch(error => {
        console.error("❌ 错误:", error.message);
    });
}

export { main };
