/**
 * 笔记模块（资料库模式）
 * 提供语义搜索和手动写入能力
 */

// ===== 接口 + Symbol Token =====
export { INoteService } from "./Service/INoteService";

// ===== 实现类 =====
export { NoteService } from "./Service/NoteService";

// ===== 存储层 =====
export { INoteDatabase } from "./Storage/INoteDatabase";
export { NoteSqliteDatabase } from "./Storage/NoteSqliteDatabase";

// ===== 工具 =====
export { NoteToolProvider, NOTE_SEARCH_TOOL_NAME, type NoteToolDescs } from "./Tools/NoteToolProvider";

// ===== 类型定义 =====
export {
  Note,
  NoteResult,
} from "./types";
