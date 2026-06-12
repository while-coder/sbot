import type {
    AgendaItem,
    AgendaOccurrence,
    AgendaRecord,
    AgendaTrigger,
} from "../types";

/**
 * 单 agenda 模板维度的存储。每个实例只读写一个模板的 db 文件，
 * 不允许跨模板访问。所有方法都隐式作用于该模板的数据。
 */
export interface IAgendaStore {
    listItems(): Promise<AgendaRecord[]>;
    findItem(itemId: number): Promise<AgendaRecord | null>;
    findTrigger(triggerId: number): Promise<{ data: AgendaRecord; trigger: AgendaTrigger } | null>;
    listEnabledTriggers(): Promise<AgendaTrigger[]>;
    createItem(item: Omit<AgendaItem, "id">): Promise<AgendaRecord>;
    updateItem(itemId: number, fields: Partial<AgendaItem>): Promise<AgendaRecord | null>;
    updateTrigger(triggerId: number, fields: Partial<AgendaTrigger>): Promise<AgendaRecord | null>;
    updateActiveTriggersByItem(itemId: number, fields: Partial<AgendaTrigger>, exceptTriggerId?: number): Promise<number[]>;
    appendTrigger(itemId: number, trigger: Omit<AgendaTrigger, "id">): Promise<AgendaTrigger | null>;
    appendOccurrence(itemId: number, occurrence: Omit<AgendaOccurrence, "id">): Promise<AgendaOccurrence | null>;
    updateOccurrence(occurrenceId: number, fields: Partial<AgendaOccurrence>): Promise<AgendaRecord | null>;
    /**
     * 把指定 item 下所有 pending 状态的 occurrence 标为 missed，doneAt 设为 missedAt。
     * 通常由 TriggerEngine 在产生新一条 pending 之前调用，把上一轮"还没 complete 的"沉淀为历史 missed。
     * 返回被标记的 occurrence id 列表（空数组表示无可标记项）。
     */
    markPendingOccurrencesMissed(itemId: number, missedAt: number): Promise<number[]>;
    deleteItem(itemId: number): Promise<AgendaRecord | null>;
    deleteAll(): Promise<number[]>;
}

export const IAgendaStore = Symbol("IAgendaStore");
