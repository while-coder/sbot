/**
 * 记忆模块导出
 */
export { IMemoryService } from "./IMemoryService";
export { MemoryService, MemoryServiceConfig } from "./MemoryService";
export { ImportanceEvaluator, ImportanceEvaluation } from "./ImportanceEvaluator";
export { MemoryCompressor, MergeStrategy, CompressionResult } from "./MemoryCompressor";

export const MEMORY_SERVICE_CONFIG = Symbol("MEMORY_SERVICE_CONFIG");
