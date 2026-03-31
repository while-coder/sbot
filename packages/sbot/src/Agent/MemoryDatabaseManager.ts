import { IMemoryDatabase, MemorySqliteDatabase } from "scorpio.ai";
import { LoggerService } from "../Core/LoggerService";

const logger = LoggerService.getLogger('MemoryDatabaseManager');

/**
 * 代理包装，dispose() 为 no-op，生命周期由 Manager 统一管理
 */
class ManagedMemoryDatabase implements IMemoryDatabase {
    constructor(private readonly inner: MemorySqliteDatabase) {}

    getAllMemories()          { return this.inner.getAllMemories(); }
    searchWithTimeDecay(...args: Parameters<IMemoryDatabase['searchWithTimeDecay']>) { return this.inner.searchWithTimeDecay(...args); }
    findDuplicate(...args: Parameters<IMemoryDatabase['findDuplicate']>)             { return this.inner.findDuplicate(...args); }
    insertMemory(...args: Parameters<IMemoryDatabase['insertMemory']>)               { return this.inner.insertMemory(...args); }
    updateAccess(...args: Parameters<IMemoryDatabase['updateAccess']>)               { return this.inner.updateAccess(...args); }
    deleteMemory(...args: Parameters<IMemoryDatabase['deleteMemory']>)               { return this.inner.deleteMemory(...args); }
    clearMemories()          { return this.inner.clearMemories(); }
    pruneMemories(...args: Parameters<IMemoryDatabase['pruneMemories']>)             { return this.inner.pruneMemories(...args); }

    async dispose(): Promise<void> { /* no-op: 由 Manager 统一管理 */ }
}

/**
 * 全局单例，管理 MemorySqliteDatabase 实例的共享和生命周期。
 * 同一 dbPath 共享同一个底层数据库连接，常驻不释放，进程退出时由 OS 回收。
 */
export class MemoryDatabaseManager {
    private static instance: MemoryDatabaseManager;
    private readonly pool = new Map<string, MemorySqliteDatabase>();

    static getInstance(): MemoryDatabaseManager {
        if (!MemoryDatabaseManager.instance) {
            MemoryDatabaseManager.instance = new MemoryDatabaseManager();
        }
        return MemoryDatabaseManager.instance;
    }

    /**
     * 获取指定路径的数据库代理实例（共享底层连接）
     */
    acquire(dbPath: string): IMemoryDatabase {
        let db = this.pool.get(dbPath);
        if (!db) {
            db = new MemorySqliteDatabase(dbPath);
            this.pool.set(dbPath, db);
            logger.info(`Created database: ${dbPath}`);
        }
        return new ManagedMemoryDatabase(db);
    }
}
