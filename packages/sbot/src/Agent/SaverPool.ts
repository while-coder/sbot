import {
    IAgentSaverService,
    AgentFileSaver,
    AgentSqliteSaver,
    AgentMemorySaver,
    ServiceContainer,
    ILoggerService,
    T_DBPath,
} from "scorpio.ai";
import { config, SaverType } from "../Core/Config";
import { LoggerService } from "../Core/LoggerService";
import { getChannelSession, getSessionProfile } from "../Core/Database";

const logger = LoggerService.getLogger('SaverPool');

export interface PooledSaver {
    saver: IAgentSaverService;
    release(): Promise<void>;
}

interface PoolEntry {
    instance: IAgentSaverService;
    refCount: number;
    dbPath: string;
}

// 同一存储位置（dbPath）只持有一个 IAgentSaverService 实例，避免多句柄并发访问同一文件/DB；
// 引用计数归零时立即 dispose。Memory 类型不进 pool，每次 acquire 都新建。
export class SaverPool {
    private static inst: SaverPool;
    private readonly pool = new Map<string, PoolEntry>();

    static getInstance(): SaverPool {
        if (!SaverPool.inst) SaverPool.inst = new SaverPool();
        return SaverPool.inst;
    }

    async acquire(saverId: string, threadId: string): Promise<PooledSaver> {
        const saverConfig = config.getSaver(saverId);
        if (saverConfig === undefined) {
            throw new Error(`Saver "${saverId}" not configured`);
        }

        if (saverConfig.type === SaverType.Memory) {
            const instance = await this.buildSaver(SaverType.Memory);
            return {
                saver: instance,
                release: () => instance.dispose(),
            };
        }

        const ext = saverConfig.type === SaverType.File ? '.json' : '.db';
        const dbPath = config.getSaverDBPath(saverId, threadId, ext);

        const existing = this.pool.get(dbPath);
        if (existing) {
            existing.refCount++;
            return this.makeHandle(existing);
        }

        const instance = await this.buildSaver(saverConfig.type, dbPath);
        const entry: PoolEntry = { instance, refCount: 1, dbPath };
        this.pool.set(dbPath, entry);
        return this.makeHandle(entry);
    }

    async acquireByDBSessionId(dbSessionId: number | string): Promise<PooledSaver> {
        const session = await getChannelSession(dbSessionId, true);
        if (!session) throw new Error(`ChannelSession not found: ${dbSessionId}`);
        const profile = await getSessionProfile(session.profileId);
        const saverId = profile?.saver || config.getChannel(session.channelId)?.saver;
        if (!saverId) throw new Error(`Session id=${session.id} has no saver configured`);
        const threadId = profile ? String(profile.id) : session.sessionId;
        return this.acquire(saverId, threadId);
    }

    private async buildSaver(type: SaverType, dbPath?: string): Promise<IAgentSaverService> {
        const sub = new ServiceContainer();
        sub.registerInstance(ILoggerService, { getLogger: (name: string) => LoggerService.getLogger(name) });
        if (type === SaverType.Memory) {
            sub.registerSingleton(IAgentSaverService, AgentMemorySaver);
        } else if (type === SaverType.File) {
            sub.registerWithArgs(IAgentSaverService, AgentFileSaver, { [T_DBPath]: dbPath });
        } else {
            sub.registerWithArgs(IAgentSaverService, AgentSqliteSaver, { [T_DBPath]: dbPath });
        }
        return sub.resolve<IAgentSaverService>(IAgentSaverService);
    }

    private makeHandle(entry: PoolEntry): PooledSaver {
        let released = false;
        return {
            saver: entry.instance,
            release: async () => {
                if (released) return;
                released = true;
                entry.refCount--;
                if (entry.refCount <= 0) {
                    this.pool.delete(entry.dbPath);
                    await entry.instance.dispose().catch(e => {
                        logger.warn(`Failed to dispose saver ${entry.dbPath}: ${e?.message ?? e}`);
                    });
                }
            },
        };
    }

    async disposeAll(): Promise<void> {
        const entries = [...this.pool.values()];
        this.pool.clear();
        await Promise.allSettled(entries.map(e => e.instance.dispose()));
        if (entries.length) logger.info(`Disposed ${entries.length} pooled saver(s)`);
    }
}
