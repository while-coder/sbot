/**
 * 记忆模块导出
 */
export { MemoryService, MemoryServiceConfig } from "./MemoryService";
export { MemoryDatabase } from "./MemoryDatabase";
export { Memory, MemoryType, MemoryMetadata, MemoryRetrievalOptions, MemorySearchResult } from "./types";
export { ImportanceEvaluator, ImportanceEvaluation } from "./ImportanceEvaluator";
export { MemoryCompressor, MergeStrategy, CompressionResult } from "./MemoryCompressor";

export const MEMORY_SERVICE_CONFIG = Symbol("MEMORY_SERVICE_CONFIG");
