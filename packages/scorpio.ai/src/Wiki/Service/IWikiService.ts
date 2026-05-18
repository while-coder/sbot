import { WikiPage, WikiSearchResult } from "../Types";

/**
 * Wiki 服务接口（资料库模式）
 */
export interface IWikiService {
    // CRUD
    createPage(title: string, content: string, tags?: string[]): Promise<WikiPage>;
    getPage(id: string): Promise<WikiPage | null>;
    getPageByTitle(title: string): Promise<WikiPage | null>;
    updatePage(id: string, updates: Partial<Pick<WikiPage, 'title' | 'content' | 'tags'>>): Promise<WikiPage>;
    deletePage(id: string): Promise<void>;

    // Search
    search(query: string, limit?: number): Promise<WikiSearchResult[]>;
    searchByTag(tag: string, limit?: number): Promise<WikiPage[]>;
    getAllPages(): Promise<WikiPage[]>;

    dispose(): Promise<void>;
}

export const IWikiService = Symbol("IWikiService");
