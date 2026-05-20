/**
 * Wiki 知识库模块（资料库模式）
 */

// ===== 接口 + Symbol Token =====
export { IWikiService } from "./Service/IWikiService";

// ===== 实现类 =====
export { WikiService } from "./Service/WikiService";

// ===== 存储层 =====
export { IWikiDatabase } from "./Database/IWikiDatabase";
export { WikiFileDatabase } from "./Database/WikiFileDatabase";

// ===== 工具 =====
export { WikiToolProvider, WIKI_SEARCH_TOOL_NAME, WIKI_READ_TOOL_NAME, type WikiToolDescs } from "./Tools/WikiToolProvider";

// ===== 类型定义 =====
export {
    WikiPage,
} from "./Types";
