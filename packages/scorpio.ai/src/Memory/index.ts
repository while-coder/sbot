/**
 * 记忆模块
 * 提供长期记忆系统接口和实现
 */

// ===== 接口 + Symbol Token =====
export { IMemoryService } from "./Service/IMemoryService";
export { IMemoryExtractor } from "./Extractor/IMemoryExtractor";

export { IMemoryCompressor } from "./Compressor/IMemoryCompressor";

// ===== 实现类 =====
export { ReadOnlyMemoryService } from "./Service/ReadOnlyMemoryService";
export { MemoryService } from "./Service/MemoryService";
export { MemoryExtractor } from "./Extractor/MemoryExtractor";

export { MemoryCompressor } from "./Compressor/MemoryCompressor";

// ===== 存储层 =====
export { IMemoryDatabase } from "./Storage/IMemoryDatabase";
export { MemorySqliteDatabase } from "./Storage/MemorySqliteDatabase";

// ===== 工具 =====
export { MemoryToolProvider } from "./Tools/MemoryToolProvider";

// ===== 类型定义 =====
// 从 types.ts 导出
export {
  Memory,
  MemoryMetadata,
  MemoryRetrievalOptions,
  MemorySearchResult,
  MemoryResult,
  MemoryMode
} from "./types";

// 从接口文件导出
export { ExtractionResult } from "./Extractor/IMemoryExtractor";

export { CompressionResult } from "./Compressor/IMemoryCompressor";
