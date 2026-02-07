/**
 * EmbeddingService 使用示例
 * 展示如何使用 EmbeddingServiceFactory 和依赖注入容器
 */

import { Container } from "../src/Core";
import { IEmbeddingService, EmbeddingServiceFactory, EmbeddingConfig } from "../src/Embedding";

async function main() {
    console.log("🔢 EmbeddingService 示例\n");

    // ============================================================
    // 示例 1: 使用工厂直接创建
    // ============================================================
    console.log("📦 [示例 1] 使用 EmbeddingServiceFactory\n");

    const factory = new EmbeddingServiceFactory();

    const config: EmbeddingConfig = {
        apiKey: "your-api-key",
        baseURL: "https://api.openai.com/v1",
        model: "text-embedding-ada-002"
    };

    const embeddingService = await factory.getEmbeddingService(config);

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
    const embeddingService2 = await factory.getEmbeddingService(config);
    console.log(`  ✅ 缓存工作正常: ${embeddingService === embeddingService2}\n`);

    // ============================================================
    // 示例 2: 使用依赖注入容器
    // ============================================================
    console.log("🔧 [示例 2] 使用依赖注入容器\n");

    const container = new Container();

    // 创建并注册 embedding 服务
    const embeddingFactory = new EmbeddingServiceFactory();
    const embeddingInstance = await embeddingFactory.getEmbeddingService(config);
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

    console.log(`  📊 当前缓存数量: ${factory.getCacheSize()}`);
    console.log(`  🔍 是否已缓存: ${factory.hasCached(config)}\n`);

    // 清理所有缓存
    console.log("  🧹 清理所有缓存...");
    await factory.clearCache();
    console.log(`  ✅ 清理完成，当前缓存数量: ${factory.getCacheSize()}\n`);

    console.log("✨ 示例完成！");
}

// 运行示例（需要有效的 API 密钥）
if (require.main === module) {
    console.log("⚠️  注意：此示例需要有效的 OpenAI API 密钥才能运行");
    console.log("⚠️  请修改 config 对象中的 apiKey\n");

    // 取消注释以下行来运行示例
    // main().catch(console.error);
}

export { main };
