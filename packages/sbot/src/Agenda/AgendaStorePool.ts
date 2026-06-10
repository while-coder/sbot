import path from "path";
import { AgendaStore, type AgendaRecord, type AgendaTriggerRow } from "scorpio.ai";
import type { SessionProfileRow } from "../Core/Database";
import { database } from "../Core/Database";
import { config } from "../Core/Config";

const ITEM_ID_FACTOR = 1_000_000;
const CHILD_ID_FACTOR = 1_000;

/**
 * 维护 profileId → 单 profile AgendaStore 的映射。
 * 跨 profile 路由（按 itemId/triggerId 反推 profile）和聚合在这一层完成，
 * AgendaStore 自身只看自己 profile 的数据。
 */
class AgendaStorePool {
    private cache = new Map<number, AgendaStore>();

    get(profileId: number): AgendaStore {
        let store = this.cache.get(profileId);
        if (!store) {
            const dbPath = path.join(config.getProfileAgendaPath(String(profileId)), "agenda.db");
            store = new AgendaStore(profileId, dbPath);
            this.cache.set(profileId, store);
        }
        return store;
    }

    remove(profileId: number): void {
        this.cache.delete(profileId);
    }

    storeForItemId(itemId: number): AgendaStore | null {
        const profileId = Math.floor(itemId / ITEM_ID_FACTOR);
        return profileId > 0 ? this.get(profileId) : null;
    }

    storeForTriggerId(triggerId: number): AgendaStore | null {
        return this.storeForItemId(Math.floor(triggerId / CHILD_ID_FACTOR));
    }

    async findItem(itemId: number): Promise<AgendaRecord | null> {
        return this.storeForItemId(itemId)?.findItem(itemId) ?? null;
    }

    async findTrigger(triggerId: number): Promise<{ data: AgendaRecord; trigger: AgendaTriggerRow } | null> {
        return this.storeForTriggerId(triggerId)?.findTrigger(triggerId) ?? null;
    }

    async listAllProfileIds(): Promise<number[]> {
        const profiles = await database.findAll<SessionProfileRow>(database.sessionProfile);
        return profiles.map(p => p.id).filter(id => Number.isInteger(id) && id > 0);
    }

    async listEnabledTriggersAcross(profileIds: number[]): Promise<AgendaTriggerRow[]> {
        const all: AgendaTriggerRow[] = [];
        for (const id of profileIds) all.push(...await this.get(id).listEnabledTriggers());
        return all.sort((a, b) => a.id - b.id);
    }

    async listItemsAcross(profileIds: number[]): Promise<AgendaRecord[]> {
        const all: AgendaRecord[] = [];
        for (const id of profileIds) all.push(...await this.get(id).listItems());
        return all.sort((a, b) => a.item.profileId - b.item.profileId || a.item.id - b.item.id);
    }
}

export const agendaStorePool = new AgendaStorePool();
