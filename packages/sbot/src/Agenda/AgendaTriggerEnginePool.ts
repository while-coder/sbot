import { agendaStorePool } from "./AgendaStorePool";
import { LoggerService } from "../Core/LoggerService";
import { AgendaTriggerEngine } from "./TriggerEngine";

const logger = LoggerService.getLogger("Agenda/AgendaTriggerEnginePool.ts");

/**
 * 维护 agendaId → AgendaTriggerEngine 的映射。
 * 每个引擎绑定一个 agenda 模板 + 对应 store，跨模板协调（启动/关闭/模板删除）由 pool 承担。
 */
class AgendaTriggerEnginePool {
    private cache = new Map<string, AgendaTriggerEngine>();

    get(agendaId: string): AgendaTriggerEngine {
        let engine = this.cache.get(agendaId);
        if (!engine) {
            engine = new AgendaTriggerEngine(agendaId, agendaStorePool.get(agendaId));
            this.cache.set(agendaId, engine);
        }
        return engine;
    }

    remove(agendaId: string): void {
        const engine = this.cache.get(agendaId);
        if (engine) {
            engine.stopAll();
            this.cache.delete(agendaId);
        }
    }

    async startAll(): Promise<void> {
        const agendaIds = agendaStorePool.listAllAgendaIds();
        for (const agendaId of agendaIds) {
            try {
                await this.get(agendaId).start();
            } catch (e: any) {
                // 单个模板启动失败（如 sqlite 文件损坏）不应阻塞其他模板的调度。
                logger.warn(`Agenda trigger engine [agenda=${agendaId}] start failed: ${e?.message ?? String(e)}`);
            }
        }
    }

    stopAll(): void {
        for (const engine of this.cache.values()) engine.stopAll();
    }
}

export const agendaTriggerEnginePool = new AgendaTriggerEnginePool();
