/** 聚合式 Wiki capability plugin。 */

export * from "./shared";

// ===== 接口 + Symbol Token =====
export { IWikiService } from "./Service/IWikiService";

// ===== 实现类 =====
export { WikiService } from "./Service/WikiService";

// ===== 存储层 =====
// 接口在核心；具体实现（本地文件 / Google Drive 等）由各 wiki 插件包提供。
export { IWikiDatabase, IWritableWikiDatabase, isWritableWikiDatabase } from "./Database/IWikiDatabase";

// ===== 工具 =====
export { WikiToolProvider, WIKI_SEARCH_TOOL_NAME, WIKI_READ_TOOL_NAME, type WikiToolDescs } from "./Tools/WikiToolProvider";

// ===== Agent 插件 =====
export { WikiAgentPlugin } from "./Plugin/WikiAgentPlugin";
export { WikiPluginLease } from "./Plugin/WikiPluginLease";

