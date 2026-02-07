/**
 * Embedding 服务模块
 */
export { IEmbeddingService } from "./IEmbeddingService";
export { OpenAIEmbeddingService } from "./OpenAIEmbeddingService";
export { EmbeddingServiceFactory } from "./EmbeddingServiceFactory";

export const EMBEDDING_CONFIG = Symbol("EMBEDDING_CONFIG");
