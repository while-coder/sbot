import { WikiPage } from "../shared";
import { WikiToolDescs } from "../Tools/WikiToolProvider";

/**
 * Wiki 服务接口（资料库模式）。
 *
 * 消费方分工：
 * - Agent 能力层（WikiAgentPlugin / WikiToolProvider）：getId / getToolDescs / getSystemMessage / search / readContent
 * - Admin 宿主（data.ts 路由）：getAllPages / readContent / savePage / deletePage
 */
export interface IWikiService {
    // ── Agent 能力 ──
    /** 本库唯一标识（settings.wikis 的 key）。 */
    getId(): string;
    // 工具描述（供 WikiToolProvider 使用）
    getToolDescs(): WikiToolDescs;
    /** 按查询检索相关页面并渲染 system prompt 注入块；无命中返回 null。 */
    getSystemMessage(query: string): Promise<string | null>;

    // ── 查询 ──
    /** 全部页面（元数据 + 正文；懒加载源未读页面 content 为空串）。 */
    getAllPages(): Promise<WikiPage[]>;
    /** 只读正文（供 wiki_read 工具用，免元数据组合）；页面不存在返回 null。 */
    readContent(id: string): Promise<string | null>;
    /** 混合检索（标题+正文，HybridSearcher）。 */
    search(query: string, limit?: number): Promise<WikiPage[]>;

    // ── 写入（只读源抛错）──
    /**
     * 新建或更新页面：patch 无 id = 新建（title/content 必填，version=1）；
     * 有 id = 增量更新（version 自增），页面不存在则报错。
     */
    savePage(patch: {
        id?: string;
        title?: string;
        content?: string;
        tags?: string[];
    }): Promise<WikiPage>;
    deletePage(id: string): Promise<void>;

    // ── 生命周期 ──
    dispose(): Promise<void>;
}

export const IWikiService = Symbol("IWikiService");
