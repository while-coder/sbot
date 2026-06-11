import path from "path";
import { AgendaStore, type AgendaRecord, type AgendaTrigger } from "scorpio.ai";
import { config } from "../Core/Config";

/**
 * 维护 agendaId → AgendaStore 的映射。
 * 每个 store 绑定一个 agenda 模板的 db 文件；跨模板的聚合在这一层完成。
 *
 * 注：旧版按 profileId 反推 store（itemId/triggerId 编进 profileId）的设计已废弃，
 * 调用方现在持有 agendaId，直接 get(agendaId) 即可。
 */
class AgendaStorePool {
    private cache = new Map<string, AgendaStore>();

    get(agendaId: string): AgendaStore {
        let store = this.cache.get(agendaId);
        if (!store) {
            const dbPath = path.join(config.getAgendaPath(agendaId), "agenda.db");
            store = new AgendaStore(dbPath);
            this.cache.set(agendaId, store);
        }
        return store;
    }

    remove(agendaId: string): void {
        const store = this.cache.get(agendaId);
        if (store) {
            store.dispose();
            this.cache.delete(agendaId);
        }
    }

    listAllAgendaIds(): string[] {
        return Object.keys(config.settings.agendaProfiles ?? {});
    }

    async listEnabledTriggersAcross(agendaIds: string[]): Promise<AgendaTrigger[]> {
        const all: AgendaTrigger[] = [];
        for (const id of agendaIds) all.push(...await this.get(id).listEnabledTriggers());
        return all.sort((a, b) => a.id - b.id);
    }

    async listItemsAcross(agendaIds: string[]): Promise<Array<{ agendaId: string; record: AgendaRecord }>> {
        const all: Array<{ agendaId: string; record: AgendaRecord }> = [];
        for (const id of agendaIds) {
            const records = await this.get(id).listItems();
            for (const record of records) all.push({ agendaId: id, record });
        }
        return all.sort((a, b) => a.agendaId.localeCompare(b.agendaId) || a.record.item.id - b.record.item.id);
    }

    disposeAll(): void {
        for (const store of this.cache.values()) store.dispose();
        this.cache.clear();
    }
}

export const agendaStorePool = new AgendaStorePool();
