import { IWikiDatabase, WikiFileDatabase } from "scorpio.ai";
import { LoggerService } from "../Core/LoggerService";

const logger = LoggerService.getLogger('WikiDatabaseManager');

/**
 * 代理包装，dispose() 为 no-op，生命周期由 Manager 统一管理
 */
class ManagedWikiDatabase implements IWikiDatabase {
    constructor(private readonly inner: WikiFileDatabase) {}

    getById(...args: Parameters<IWikiDatabase['getById']>)                 { return this.inner.getById(...args); }
    getByTitle(...args: Parameters<IWikiDatabase['getByTitle']>)           { return this.inner.getByTitle(...args); }
    getByTags(...args: Parameters<IWikiDatabase['getByTags']>)             { return this.inner.getByTags(...args); }
    searchByText(...args: Parameters<IWikiDatabase['searchByText']>)       { return this.inner.searchByText(...args); }
    getAll()                                                               { return this.inner.getAll(); }
    insert(...args: Parameters<IWikiDatabase['insert']>)                   { return this.inner.insert(...args); }
    update(...args: Parameters<IWikiDatabase['update']>)                   { return this.inner.update(...args); }
    delete(...args: Parameters<IWikiDatabase['delete']>)                   { return this.inner.delete(...args); }

    async dispose(): Promise<void> { /* no-op: 由 Manager 统一管理 */ }
}

/**
 * 全局单例，管理 WikiFileDatabase 实例的共享和生命周期。
 * 同一 dir 共享同一个底层实例，常驻不释放，进程退出时由 OS 回收。
 */
export class WikiDatabaseManager {
    private static instance: WikiDatabaseManager;
    private readonly pool = new Map<string, WikiFileDatabase>();

    static getInstance(): WikiDatabaseManager {
        if (!WikiDatabaseManager.instance) {
            WikiDatabaseManager.instance = new WikiDatabaseManager();
        }
        return WikiDatabaseManager.instance;
    }

    /**
     * 获取指定路径的数据库代理实例（共享底层实例）
     */
    acquire(dbPath: string): IWikiDatabase {
        let db = this.pool.get(dbPath);
        if (!db) {
            db = new WikiFileDatabase(dbPath);
            this.pool.set(dbPath, db);
            logger.info(`Created database: ${dbPath}`);
        }
        return new ManagedWikiDatabase(db);
    }
}
