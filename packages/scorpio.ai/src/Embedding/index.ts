/**
 * Embedding 服务模块
 * 提供文本向量化服务接口和实现
 */

// ===== Provider 无关接口 =====
export { EmbeddingProvider, IEmbeddingService } from "scorpio.llm";
export type { EmbeddingConfig } from "scorpio.llm";

// ===== 工厂和配置 =====
export { EmbeddingServiceFactory } from "./EmbeddingServiceFactory";
