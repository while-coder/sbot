import type {
    AgendaCreateArgs,
    AgendaItemView,
    AgendaUpdatePatch,
} from "../types";

export enum AgendaActionType {
    Create = 'create',
    Update = 'update',
    Complete = 'complete',
    Cancel = 'cancel',
}

export type AgendaAction =
    | { type: AgendaActionType.Create; args: AgendaCreateArgs }
    | { type: AgendaActionType.Update; id: number; patch: AgendaUpdatePatch }
    | { type: AgendaActionType.Complete; id: number }
    | { type: AgendaActionType.Cancel; id: number };

export interface IAgendaExtractor {
    extract(userMessage: string, assistantMessages: string[], existingItems: AgendaItemView[]): Promise<AgendaAction[]>;
}

export const IAgendaExtractor = Symbol("IAgendaExtractor");
