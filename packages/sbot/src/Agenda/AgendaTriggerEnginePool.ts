import { agendaStorePool } from "./AgendaStorePool";
import { LoggerService } from "../Core/LoggerService";
import { AgendaTriggerEngine } from "./TriggerEngine";

const ITEM_ID_FACTOR = 1_000_000;
const CHILD_ID_FACTOR = 1_000;

const logger = LoggerService.getLogger("Agenda/AgendaTriggerEnginePool.ts");

/**
 * 维护 profileId → 单 profile AgendaTriggerEngine 的映射。
 * 每个引擎绑定一个 profile + 对应 store，跨 profile 协调（启动/关闭/profile 删除）由 pool 承担。
 */
class AgendaTriggerEnginePool {
    private cache = new Map<number, AgendaTriggerEngine>();

    get(profileId: number): AgendaTriggerEngine {
        let engine = this.cache.get(profileId);
        if (!engine) {
            engine = new AgendaTriggerEngine(profileId, agendaStorePool.get(profileId));
            this.cache.set(profileId, engine);
        }
        return engine;
    }

    remove(profileId: number): void {
        const engine = this.cache.get(profileId);
        if (engine) {
            engine.stopAll();
            this.cache.delete(profileId);
        }
    }

    engineForItemId(itemId: number): AgendaTriggerEngine | null {
        const profileId = Math.floor(itemId / ITEM_ID_FACTOR);
        return profileId > 0 ? this.get(profileId) : null;
    }

    engineForTriggerId(triggerId: number): AgendaTriggerEngine | null {
        return this.engineForItemId(Math.floor(triggerId / CHILD_ID_FACTOR));
    }

    async startAll(): Promise<void> {
        const profileIds = await agendaStorePool.listAllProfileIds();
        for (const profileId of profileIds) {
            try {
                await this.get(profileId).start();
            } catch (e: any) {
                // 单个 profile 启动失败（如 sqlite 文件损坏）不应阻塞其他 profile 的调度。
                logger.warn(`Agenda trigger engine [profile=${profileId}] start failed: ${e?.message ?? String(e)}`);
            }
        }
    }

    stopAll(): void {
        for (const engine of this.cache.values()) engine.stopAll();
    }
}

export const agendaTriggerEnginePool = new AgendaTriggerEnginePool();
