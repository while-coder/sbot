/**
 * 记忆模块（资料库模式）
 * 提供语义搜索和手动写入能力
 */

// ===== 接口 + Symbol Token =====
export { IMemoryService } from "./Service/IMemoryService";

// ===== 实现类 =====
export { MemoryService } from "./Service/MemoryService";

// ===== 存储层 =====
export { IMemoryDatabase } from "./Storage/IMemoryDatabase";
export { MemorySqliteDatabase } from "./Storage/MemorySqliteDatabase";

// ===== 工具 =====
export { MemoryToolProvider, MEMORY_SEARCH_TOOL_NAME } from "./Tools/MemoryToolProvider";

// ===== 类型定义 =====
export {
  Memory,
  MemoryResult,
} from "./types";
