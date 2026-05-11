import { ACPAgentService } from "scorpio.ai";
import { LoggerService } from "../Core/LoggerService";

const logger = LoggerService.getLogger('ACPAgentPool');

export interface ACPPoolEntry {
    instance: ACPAgentService;
    key: string;
    agentId: string;
    agentName: string;
    dbSessionId: string;
    configHash: string;
    createdAt: number;
    lastAccessed: number;
}

export interface ACPPoolInfo {
    key: string;
    agentId: string;
    agentName: string;
    dbSessionId: string;
    createdAt: number;
    lastAccessed: number;
    alive: boolean;
}

export class ACPAgentPool {
    private static inst: ACPAgentPool;
    private readonly pool = new Map<string, ACPPoolEntry>();

    static getInstance(): ACPAgentPool {
        if (!ACPAgentPool.inst) {
            ACPAgentPool.inst = new ACPAgentPool();
        }
        return ACPAgentPool.inst;
    }

    async acquire(
        key: string,
        agentId: string,
        agentName: string,
        dbSessionId: string,
        configHash: string,
        factory: () => Promise<ACPAgentService>,
    ): Promise<ACPAgentService> {
        const existing = this.pool.get(key);

        if (existing) {
            if (existing.configHash !== configHash) {
                logger.info(`Config changed for ${key}, recreating`);
                await existing.instance.forceDispose();
                this.pool.delete(key);
            } else if (existing.instance.isAlive()) {
                existing.lastAccessed = Date.now();
                return existing.instance;
            } else {
                logger.warn(`Dead process for ${key}, recreating`);
                this.pool.delete(key);
            }
        }

        const instance = await factory();
        instance.pooled = true;
        instance.onExit = () => {
            const entry = this.pool.get(key);
            if (entry?.instance === instance) {
                logger.warn(`ACP process died unexpectedly: ${key}`);
                this.pool.delete(key);
            }
        };

        const entry: ACPPoolEntry = {
            instance,
            key,
            agentId,
            agentName,
            dbSessionId,
            configHash,
            createdAt: Date.now(),
            lastAccessed: Date.now(),
        };
        this.pool.set(key, entry);
        logger.info(`Cached ACP instance: ${key}`);
        return instance;
    }

    async release(key: string): Promise<void> {
        const entry = this.pool.get(key);
        if (!entry) return;
        this.pool.delete(key);
        await entry.instance.forceDispose();
        logger.info(`Released ACP instance: ${key}`);
    }

    async disposeAll(): Promise<void> {
        const entries = [...this.pool.values()];
        this.pool.clear();
        await Promise.allSettled(entries.map(e => e.instance.forceDispose()));
        if (entries.length) logger.info(`Disposed ${entries.length} cached ACP instance(s)`);
    }

    list(): ACPPoolInfo[] {
        return [...this.pool.values()].map(e => ({
            key: e.key,
            agentId: e.agentId,
            agentName: e.agentName,
            dbSessionId: e.dbSessionId,
            createdAt: e.createdAt,
            lastAccessed: e.lastAccessed,
            alive: e.instance.isAlive(),
        }));
    }
}
