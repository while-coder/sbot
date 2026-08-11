import {
    IAgentSaverService,
    saverProviderRegistry,
    type SaverCreateContext,
} from "scorpio.saver";
import { config } from "../Core/Config";
import { LoggerService } from "../Core/LoggerService";
import { channelDataService } from "../Session/ChannelDataService";

const logger = LoggerService.getLogger('SaverPool');

export interface PooledSaver {
    saver: IAgentSaverService;
    release(): Promise<void>;
}

interface PoolEntry {
    instance: IAgentSaverService;
    refCount: number;
    poolKey: string;
}

// 同一 Provider 存储位置只持有一个实例，避免多句柄并发访问同一文件/DB；
// 引用计数归零时立即 dispose。非 pooled Provider 每次 acquire 都新建。
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

        const provider = saverProviderRegistry.get(saverConfig.type);
        if (!provider) {
            throw new Error(`Saver provider is not registered: ${saverConfig.type}`);
        }

        const storagePath = provider.fileExtension
            ? config.getSaverDBPath(saverId, threadId, provider.fileExtension)
            : undefined;
        const context: SaverCreateContext = {
            saverId,
            threadId,
            storagePath,
            config: saverConfig.config ?? {},
            loggerService: { getLogger: name => LoggerService.getLogger(name) },
        };

        if (!provider.pooled) {
            const instance = await provider.create(context);
            return {
                saver: instance,
                release: () => instance.dispose(),
            };
        }

        const poolKey = provider.getPoolKey?.(context)
            ?? storagePath
            ?? `${saverConfig.type}:${saverId}:${threadId}`;

        const existing = this.pool.get(poolKey);
        if (existing) {
            existing.refCount++;
            return this.makeHandle(existing);
        }

        const instance = await provider.create(context);
        const entry: PoolEntry = { instance, refCount: 1, poolKey };
        this.pool.set(poolKey, entry);
        return this.makeHandle(entry);
    }

    async acquireByDBSessionId(dbSessionId: number | string): Promise<PooledSaver> {
        const session = await channelDataService.getSession(dbSessionId, true);
        if (!session) throw new Error(`ChannelSession not found: ${dbSessionId}`);
        const profile = await channelDataService.getProfile(session.profileId);
        const saverId = profile?.saver || config.getChannel(session.channelId)?.saver;
        if (!saverId) throw new Error(`Session id=${session.id} has no saver configured`);
        const threadId = profile ? String(profile.id) : session.sessionId;
        return this.acquire(saverId, threadId);
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
                    this.pool.delete(entry.poolKey);
                    await entry.instance.dispose().catch(e => {
                        logger.warn(`Failed to dispose saver ${entry.poolKey}: ${e?.message ?? e}`);
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
