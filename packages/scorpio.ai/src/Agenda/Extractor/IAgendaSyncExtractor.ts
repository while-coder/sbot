import type {
    AgendaCreateArgs,
    AgendaItemView,
    AgendaUpdatePatch,
} from "../types";

export enum AgendaSyncActionType {
    Create = 'create',
    Update = 'update',
    Complete = 'complete',
    Cancel = 'cancel',
}

export type AgendaSyncAction =
    | { type: AgendaSyncActionType.Create; args: AgendaCreateArgs }
    | { type: AgendaSyncActionType.Update; id: number; patch: AgendaUpdatePatch }
    | { type: AgendaSyncActionType.Complete; id: number }
    | { type: AgendaSyncActionType.Cancel; id: number };

export interface IAgendaSyncExtractor {
    extract(userMessage: string, assistantMessages: string[], existingItems: AgendaItemView[]): Promise<AgendaSyncAction[]>;
}

export const IAgendaSyncExtractor = Symbol("IAgendaSyncExtractor");
