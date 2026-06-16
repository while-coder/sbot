import type { ChatMessage } from "../../Saver";
import type {
    AgendaCreateArgs,
    AgendaRecord,
    AgendaTriggerCreateArgs,
    AgendaTriggerReplaceAllArgs,
    AgendaTriggerUpdatePatch,
    AgendaUpdatePatch,
} from "../types";

export enum AgendaActionType {
    Create = 'create',
    Update = 'update',
    Complete = 'complete',
    Cancel = 'cancel',
    TriggerAdd = 'trigger_add',
    TriggerUpdate = 'trigger_update',
    TriggerRemove = 'trigger_remove',
    TriggerReplaceAll = 'trigger_replace_all',
}

export type AgendaAction =
    | { type: AgendaActionType.Create; args: AgendaCreateArgs }
    | { type: AgendaActionType.Update; id: number; patch: AgendaUpdatePatch }
    | { type: AgendaActionType.Complete; id: number; at?: string }
    | { type: AgendaActionType.Cancel; id: number }
    | { type: AgendaActionType.TriggerAdd; itemId: number; args: AgendaTriggerCreateArgs }
    | { type: AgendaActionType.TriggerUpdate; triggerId: number; patch: AgendaTriggerUpdatePatch }
    | { type: AgendaActionType.TriggerRemove; triggerId: number }
    | { type: AgendaActionType.TriggerReplaceAll; itemId: number; args: AgendaTriggerReplaceAllArgs };

export interface IAgendaExtractor {
    extract(messages: ChatMessage[], existingItems: AgendaRecord[]): Promise<AgendaAction[]>;
}

export const IAgendaExtractor = Symbol("IAgendaExtractor");
