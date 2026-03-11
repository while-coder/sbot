/**
 * Embedding 服务模块
 * 提供文本向量化服务接口和实现
 */

// ===== 接口 + Symbol Token =====
export { IEmbeddingService } from "./IEmbeddingService";

// ===== 实现类 =====
export { OpenAIEmbeddingService } from "./OpenAIEmbeddingService";

// ===== 工厂和配置 =====
export { EmbeddingServiceFactory } from "./EmbeddingServiceFactory";

// ===== 类型定义 =====
export { EmbeddingConfig, EmbeddingProvider } from "./types";
