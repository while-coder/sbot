/**
 * EmbeddingService 使用示例
 * 展示如何使用 EmbeddingServiceFactory 和依赖注入容器
 */

import { Container } from "../src/Core";
import { IEmbeddingService, EmbeddingServiceFactory } from "../src/Embedding";
import { config } from "../src/Config";

async function main() {
    console.log("🔢 EmbeddingService 示例\n");

    // ============================================================
    // 示例 1: 使用工厂静态方法直接创建
    // ============================================================
    console.log("📦 [示例 1] 使用 EmbeddingServiceFactory 静态方法\n");

    // 从配置文件获取当前 embedding 名称
    const embeddingName = config.getEmbeddingName();
    if (!embeddingName) {
        console.log("  ❌ 未配置 embedding，请在 ~/.sbot/settings.toml 中配置");
        return;
    }

    console.log(`  使用 embedding: ${embeddingName}`);

    const embeddingService = await EmbeddingServiceFactory.getEmbeddingService(embeddingName);

    // 为单个文本生成 embedding
    console.log("  📝 为单个文本生成 embedding...");
    const text = "Hello, world!";
    const embedding = await embeddingService.embedQuery(text);
    console.log(`  ✅ 生成了 ${embedding.length} 维的向量\n`);

    // 为多个文本批量生成 embeddings
    console.log("  📝 为多个文本批量生成 embeddings...");
    const texts = ["Hello", "World", "OpenAI"];
    const embeddings = await embeddingService.embedDocuments(texts);
    console.log(`  ✅ 为 ${texts.length} 个文本生成了 embeddings\n`);

    // 验证缓存机制
    console.log("  🔍 验证缓存机制...");
    const embeddingService2 = await EmbeddingServiceFactory.getEmbeddingService(embeddingName);
    console.log(`  ✅ 缓存工作正常: ${embeddingService === embeddingService2}\n`);

    // ============================================================
    // 示例 2: 使用依赖注入容器
    // ============================================================
    console.log("🔧 [示例 2] 使用依赖注入容器\n");

    const container = new Container();

    // 创建并注册 embedding 服务（使用静态方法，传入名称）
    const embeddingInstance = await EmbeddingServiceFactory.getEmbeddingService(embeddingName);
    container.registerInstance(IEmbeddingService, embeddingInstance);

    // 定义一个需要 embedding 服务的类
    class TextAnalyzer {
        constructor(
            private embeddingService: IEmbeddingService
        ) {}

        async analyzeSimilarity(text1: string, text2: string): Promise<number> {
            const [emb1, emb2] = await this.embeddingService.embedDocuments([text1, text2]);
            return this.cosineSimilarity(emb1, emb2);
        }

        private cosineSimilarity(a: number[], b: number[]): number {
            let dotProduct = 0;
            let normA = 0;
            let normB = 0;

            for (let i = 0; i < a.length; i++) {
                dotProduct += a[i] * b[i];
                normA += a[i] * a[i];
                normB += b[i] * b[i];
            }

            return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
        }
    }

    // 手动创建并传入依赖
    const analyzer = new TextAnalyzer(embeddingInstance);

    console.log("  📊 计算文本相似度...");
    const similarity = await analyzer.analyzeSimilarity(
        "I love programming",
        "I enjoy coding"
    );
    console.log(`  ✅ 相似度: ${similarity.toFixed(4)}\n`);

    // ============================================================
    // 示例 3: 工厂管理和清理
    // ============================================================
    console.log("🧹 [示例 3] 工厂管理和清理\n");

    const cachedEmbeddings = EmbeddingServiceFactory.getCachedEmbeddings();
    console.log(`  📊 已缓存的 embeddings: ${cachedEmbeddings.join(", ")}`);
    console.log(`  🔍 是否已缓存 ${embeddingName}: ${EmbeddingServiceFactory.hasCached(embeddingName)}\n`);

    // 清理所有缓存
    console.log("  🧹 清理所有缓存...");
    await EmbeddingServiceFactory.clearCache();
    console.log(`  ✅ 清理完成，缓存的 embeddings: ${EmbeddingServiceFactory.getCachedEmbeddings().join(", ") || "无"}\n`);

    console.log("✨ 示例完成！");
}

// 运行示例（需要有效的配置）
if (require.main === module) {
    console.log("⚠️  注意：此示例需要在 ~/.sbot/settings.toml 中配置 embedding");
    console.log("⚠️  请参考 EmbeddingConfigExample.ts 了解配置格式\n");

    // 取消注释以下行来运行示例
    // main().catch(console.error);
}

export { main };
