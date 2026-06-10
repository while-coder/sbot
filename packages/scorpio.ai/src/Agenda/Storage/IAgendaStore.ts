import type {
    AgendaOccurrence,
    AgendaRecord,
    AgendaRecordInput,
    AgendaStoredItem,
    AgendaTrigger,
} from "../types";

/**
 * 单 profile 维度的 agenda 存储。每个实例只读写一个 profile 的 db 文件，
 * 不允许跨 profile 访问。所有方法都隐式作用于该 profile 的数据。
 */
export interface IAgendaStore {
    listItems(): Promise<AgendaRecord[]>;
    findItem(itemId: number): Promise<AgendaRecord | null>;
    findTrigger(triggerId: number): Promise<{ data: AgendaRecord; trigger: AgendaTrigger } | null>;
    listEnabledTriggers(): Promise<AgendaTrigger[]>;
    createItem(build: (id: number) => AgendaRecordInput): Promise<AgendaRecord>;
    updateItem(itemId: number, fields: Partial<AgendaStoredItem>): Promise<AgendaRecord | null>;
    updateTrigger(triggerId: number, fields: Partial<AgendaTrigger>): Promise<AgendaRecord | null>;
    updateActiveTriggersByItem(itemId: number, fields: Partial<AgendaTrigger>, exceptTriggerId?: number): Promise<number[]>;
    appendTrigger(itemId: number, trigger: Omit<AgendaTrigger, "id">): Promise<AgendaTrigger | null>;
    appendOccurrence(itemId: number, occurrence: Omit<AgendaOccurrence, "id">): Promise<AgendaOccurrence | null>;
    updateOccurrence(occurrenceId: number, fields: Partial<AgendaOccurrence>): Promise<AgendaRecord | null>;
    deleteItem(itemId: number): Promise<AgendaRecord | null>;
    deleteAll(): Promise<number[]>;
}

export const IAgendaStore = Symbol("IAgendaStore");
