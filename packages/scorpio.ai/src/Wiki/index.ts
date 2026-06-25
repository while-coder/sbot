/**
 * Wiki 知识库模块（资料库模式）
 */

// ===== 接口 + Symbol Token =====
export { IWikiService } from "./Service/IWikiService";

// ===== 实现类 =====
export { WikiService } from "./Service/WikiService";

// ===== 存储层 =====
// 接口在核心；具体实现（本地文件 / Google Drive 等）由各 wiki 插件包提供。
export { IWikiDatabase } from "./Database/IWikiDatabase";

// ===== 工具 =====
export { WikiToolProvider, WIKI_SEARCH_TOOL_NAME, WIKI_READ_TOOL_NAME, type WikiToolDescs } from "./Tools/WikiToolProvider";

// ===== 类型定义 =====
export {
    WikiPage,
} from "./Types";
