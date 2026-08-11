/** 聚合式 Note capability plugin。 */

export * from "./shared";

// ===== 接口 + Symbol Token =====
export { INoteService } from "./Service/INoteService";

// ===== 实现类 =====
export { NoteService } from "./Service/NoteService";

// ===== 存储层 =====
export { INoteDatabase } from "./Storage/INoteDatabase";
export { NoteSqliteDatabase } from "./Storage/NoteSqliteDatabase";

// ===== 工具 =====
export { NoteToolProvider, NOTE_SEARCH_TOOL_NAME, type NoteToolDescs } from "./Tools/NoteToolProvider";

// ===== Agent 插件 =====
export { NoteAgentPlugin } from "./Plugin/NoteAgentPlugin";
export { NotePluginLease } from "./Plugin/NotePluginLease";
