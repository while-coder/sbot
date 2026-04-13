/**
 * Wiki 知识库模块
 * 提供 AI 驱动的结构化知识库系统
 */

// ===== 接口 + Symbol Token =====
export { IWikiService } from "./Service/IWikiService";
export { IWikiExtractor } from "./Extractor/IWikiExtractor";

// ===== 实现类 =====
export { WikiService } from "./Service/WikiService";
export { WikiExtractor } from "./Extractor/WikiExtractor";

// ===== 存储层 =====
export { IWikiDatabase } from "./Database/IWikiDatabase";
export { WikiFileDatabase } from "./Database/WikiFileDatabase";

// ===== 工具 =====
export { WikiToolProvider } from "./Tools/WikiToolProvider";

// ===== 类型定义 =====
export {
    WikiPage,
    WikiPageSource,
    WikiSearchResult,
    ExtractedKnowledge,
} from "./Types";
