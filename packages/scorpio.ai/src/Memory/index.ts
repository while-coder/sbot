/**
 * 记忆模块
 * 提供长期记忆系统接口和实现
 */

// ===== 接口 + Symbol Token =====
export { IMemoryService } from "./Service/IMemoryService";
export { IMemoryExtractor } from "./Extractor/IMemoryExtractor";
export { IMemoryEvaluator } from "./Evaluator/IMemoryEvaluator";
export { IMemoryCompressor } from "./Compressor/IMemoryCompressor";

// ===== 实现类 =====
export { MemoryNoneService } from "./Service/MemoryNoneService";
export { ReadOnlyMemoryService } from "./Service/ReadOnlyMemoryService";
export { MemoryService } from "./Service/MemoryService";
export { MemoryExtractor } from "./Extractor/MemoryExtractor";
export { MemoryEvaluator } from "./Evaluator/MemoryEvaluator";
export { MemoryCompressor } from "./Compressor/MemoryCompressor";

// ===== 存储层 =====
export { IMemoryDatabase } from "./Storage/IMemoryDatabase";
export { MemorySqliteDatabase } from "./Storage/MemorySqliteDatabase";

// ===== 类型定义 =====
// 从 types.ts 导出
export {
  Memory,
  MemoryMetadata,
  MemoryRetrievalOptions,
  MemorySearchResult,
  MemoryMode
} from "./types";

// 从接口文件导出
export { ExtractionResult } from "./Extractor/IMemoryExtractor";
export { EvaluationResult } from "./Evaluator/IMemoryEvaluator";
export { CompressionResult, MergeStrategy } from "./Compressor/IMemoryCompressor";
