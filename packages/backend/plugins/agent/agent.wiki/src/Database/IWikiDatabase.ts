import { WikiPage } from "../shared";

/**
 * Wiki 数据库接口（只读契约）。
 * 定义 Wiki 存储层的标准接口；支持写入的数据源额外实现 IWritableWikiDatabase。
 */
export interface IWikiDatabase {
    // --- 查询 ---
    /**
     * 列出全部页面（元数据 + 正文）。
     * content 允许为空串（懒加载源未读的页面）或缓存内容，不强求实时。
     */
    getAll(): Promise<WikiPage[]>;
    /** 读取单页正文（实时拉取）；页面不存在返回 null。 */
    readContent(id: string): Promise<string | null>;

    // --- 生命周期 ---
    dispose(): Promise<void>;
}

/**
 * 可写 wiki 数据源（如 wiki.local）。默认契约只读，写能力是可选扩展：
 * 实现本接口的数据源，WikiService 通过 isWritableWikiDatabase 运行时探测后启用写路径。
 */
export interface IWritableWikiDatabase extends IWikiDatabase {
    insert(page: WikiPage): Promise<void>;
    update(id: string, page: Partial<WikiPage>): Promise<void>;
    delete(id: string): Promise<void>;
}

/** 运行时探测数据源是否支持写入。 */
export function isWritableWikiDatabase(db: IWikiDatabase): db is IWritableWikiDatabase {
    return typeof (db as any).insert === "function"
        && typeof (db as any).update === "function"
        && typeof (db as any).delete === "function";
}

export const IWikiDatabase = Symbol("IWikiDatabase");
