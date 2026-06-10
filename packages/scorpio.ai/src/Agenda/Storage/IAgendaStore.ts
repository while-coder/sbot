import type {
    AgendaOccurrenceRow,
    AgendaRecord,
    AgendaRecordInput,
    AgendaStoredItemRow,
    AgendaTriggerRow,
} from "../types";

/**
 * 单 profile 维度的 agenda 存储。每个实例只读写一个 profile 的 db 文件，
 * 不允许跨 profile 访问。所有方法都隐式作用于该 profile 的数据。
 */
export interface IAgendaStore {
    listItems(): Promise<AgendaRecord[]>;
    findItem(itemId: number): Promise<AgendaRecord | null>;
    findTrigger(triggerId: number): Promise<{ data: AgendaRecord; trigger: AgendaTriggerRow } | null>;
    listEnabledTriggers(): Promise<AgendaTriggerRow[]>;
    createItem(build: (id: number) => AgendaRecordInput): Promise<AgendaRecord>;
    updateItem(itemId: number, fields: Partial<AgendaStoredItemRow>): Promise<AgendaRecord | null>;
    updateTrigger(triggerId: number, fields: Partial<AgendaTriggerRow>): Promise<AgendaRecord | null>;
    updateActiveTriggersByItem(itemId: number, fields: Partial<AgendaTriggerRow>, exceptTriggerId?: number): Promise<number[]>;
    appendTrigger(itemId: number, trigger: Omit<AgendaTriggerRow, "id">): Promise<AgendaTriggerRow | null>;
    appendOccurrence(itemId: number, occurrence: Omit<AgendaOccurrenceRow, "id">): Promise<AgendaOccurrenceRow | null>;
    updateOccurrence(occurrenceId: number, fields: Partial<AgendaOccurrenceRow>): Promise<AgendaRecord | null>;
    deleteItem(itemId: number): Promise<AgendaRecord | null>;
    deleteAll(): Promise<number[]>;
}

export const IAgendaStore = Symbol("IAgendaStore");
