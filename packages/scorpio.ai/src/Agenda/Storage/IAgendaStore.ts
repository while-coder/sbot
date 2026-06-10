import type {
    AgendaFireLogRow,
    AgendaOccurrenceRow,
    AgendaRecord,
    AgendaRecordInput,
    AgendaRecordRef,
    AgendaStoredItemRow,
    AgendaTriggerRow,
} from "../types";

export interface IAgendaStore {
    listProfileItems(profileId: number): Promise<AgendaRecordRef[]>;
    listAllItems(profileIds: number[]): Promise<AgendaRecordRef[]>;
    findByItemId(itemId: number): Promise<AgendaRecordRef | null>;
    findByTriggerId(triggerId: number): Promise<{ dbPath: string; data: AgendaRecord; trigger: AgendaTriggerRow } | null>;
    listEnabledTriggers(profileIds: number[]): Promise<AgendaTriggerRow[]>;
    createItem(profileId: number, build: (id: number) => AgendaRecordInput): Promise<AgendaRecord>;
    updateItem(itemId: number, fields: Partial<AgendaStoredItemRow>): Promise<AgendaRecord | null>;
    updateTrigger(triggerId: number, fields: Partial<AgendaTriggerRow>): Promise<AgendaRecord | null>;
    updateActiveTriggersByItem(itemId: number, fields: Partial<AgendaTriggerRow>, exceptTriggerId?: number): Promise<number[]>;
    appendTrigger(itemId: number, trigger: Omit<AgendaTriggerRow, "id">): Promise<AgendaTriggerRow | null>;
    appendOccurrence(itemId: number, occurrence: Omit<AgendaOccurrenceRow, "id">): Promise<AgendaOccurrenceRow | null>;
    appendFireLog(itemId: number, log: Omit<AgendaFireLogRow, "id">): Promise<AgendaFireLogRow | null>;
    updateOccurrence(occurrenceId: number, fields: Partial<AgendaOccurrenceRow>): Promise<AgendaRecord | null>;
    deleteItem(itemId: number): Promise<AgendaRecord | null>;
    deleteProfile(profileId: number): Promise<number[]>;
}

export const IAgendaStore = Symbol("IAgendaStore");
