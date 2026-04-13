import { WikiPage, WikiSearchResult } from "../Types";

export interface IWikiService {
    // CRUD
    createPage(title: string, content: string, tags?: string[], links?: string[]): Promise<WikiPage>;
    getPage(id: string): Promise<WikiPage | null>;
    getPageByTitle(title: string): Promise<WikiPage | null>;
    updatePage(id: string, updates: Partial<Pick<WikiPage, 'title' | 'content' | 'tags' | 'links'>>): Promise<WikiPage>;
    deletePage(id: string): Promise<void>;

    // Search
    search(query: string, limit?: number): Promise<WikiSearchResult[]>;
    searchByTag(tag: string, limit?: number): Promise<WikiPage[]>;
    getLinkedPages(pageId: string): Promise<WikiPage[]>;
    getAllPages(): Promise<WikiPage[]>;

    // Conversation auto-extraction
    extractFromConversation(userMessage: string, assistantMessages?: string[]): Promise<WikiPage[]>;

    // Maintenance
    mergeSimilarPages(): Promise<number>;

    dispose(): Promise<void>;
}

export const IWikiService = Symbol("IWikiService");
