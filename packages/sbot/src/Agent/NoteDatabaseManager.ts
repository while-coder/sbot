import { INoteDatabase, NoteSqliteDatabase } from "scorpio.ai";
import { LoggerService } from "../Core/LoggerService";

const logger = LoggerService.getLogger('NoteDatabaseManager');

/**
 * 代理包装，dispose() 为 no-op，生命周期由 Manager 统一管理
 */
class ManagedNoteDatabase implements INoteDatabase {
    constructor(private readonly inner: NoteSqliteDatabase) {}

    getAllNotes()          { return this.inner.getAllNotes(); }
    searchWithTimeDecay(...args: Parameters<INoteDatabase['searchWithTimeDecay']>) { return this.inner.searchWithTimeDecay(...args); }
    findDuplicate(...args: Parameters<INoteDatabase['findDuplicate']>)             { return this.inner.findDuplicate(...args); }
    insertNote(...args: Parameters<INoteDatabase['insertNote']>)                   { return this.inner.insertNote(...args); }
    updateNote(...args: Parameters<INoteDatabase['updateNote']>)                   { return this.inner.updateNote(...args); }
    updateAccess(...args: Parameters<INoteDatabase['updateAccess']>)               { return this.inner.updateAccess(...args); }
    deleteNote(...args: Parameters<INoteDatabase['deleteNote']>)                   { return this.inner.deleteNote(...args); }
    clearNotes()           { return this.inner.clearNotes(); }

    async dispose(): Promise<void> { /* no-op: 由 Manager 统一管理 */ }
}

/**
 * 全局单例，管理 NoteSqliteDatabase 实例的共享和生命周期。
 * 同一 dbPath 共享同一个底层数据库连接，常驻不释放，进程退出时由 OS 回收。
 */
export class NoteDatabaseManager {
    private static instance: NoteDatabaseManager;
    private readonly pool = new Map<string, NoteSqliteDatabase>();

    static getInstance(): NoteDatabaseManager {
        if (!NoteDatabaseManager.instance) {
            NoteDatabaseManager.instance = new NoteDatabaseManager();
        }
        return NoteDatabaseManager.instance;
    }

    /**
     * 获取指定路径的数据库代理实例（共享底层连接）
     */
    acquire(dbPath: string): INoteDatabase {
        let db = this.pool.get(dbPath);
        if (!db) {
            db = new NoteSqliteDatabase(dbPath);
            this.pool.set(dbPath, db);
            logger.info(`Created database: ${dbPath}`);
        }
        return new ManagedNoteDatabase(db);
    }
}
