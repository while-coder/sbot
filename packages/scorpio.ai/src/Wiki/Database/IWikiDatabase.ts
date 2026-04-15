import { WikiPage } from "../Types";

/**
 * Wiki 数据库接口
 * 定义 Wiki 存储层的标准接口
 */
export interface IWikiDatabase {
    // --- 查询 ---
    getById(id: string): Promise<WikiPage | null>;
    getByTitle(title: string): Promise<WikiPage | null>;
    getByTags(tags: string[]): Promise<WikiPage[]>;
    searchByText(query: string, limit: number): Promise<WikiPage[]>;
    getAll(): Promise<WikiPage[]>;

    // --- 写入 ---
    insert(page: WikiPage): Promise<void>;
    update(id: string, page: Partial<WikiPage>): Promise<void>;
    delete(id: string): Promise<void>;

    // --- 生命周期 ---
    dispose(): Promise<void>;
}

export const IWikiDatabase = Symbol("IWikiDatabase");
