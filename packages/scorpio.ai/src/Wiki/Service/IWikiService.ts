import { WikiPage } from "../Types";
import { WikiToolDescs } from "../Tools/WikiToolProvider";

/**
 * Wiki 服务接口（资料库模式）
 */
export interface IWikiService {
    // 系统提示词
    getSystemMessage(query: string): Promise<string | null>;

    // 工具描述（供 WikiToolProvider 使用）
    getToolDescs(): WikiToolDescs;

    // CRUD
    getPage(id: string): Promise<WikiPage | null>;
    getByTags(tag: string, limit?: number): Promise<WikiPage[]>;
    createPage(title: string, content: string, tags?: string[]): Promise<WikiPage>;
    updatePage(id: string, updates: Partial<Pick<WikiPage, 'title' | 'content' | 'tags'>>): Promise<WikiPage>;
    deletePage(id: string): Promise<void>;
    getAllPages(): Promise<WikiPage[]>;

    // Search
    search(query: string, limit?: number): Promise<WikiPage[]>;

    dispose(): Promise<void>;
}

export const IWikiService = Symbol("IWikiService");
