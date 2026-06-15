import type { ChatMessage } from "../../Saver";
import type {
    AgendaCreateArgs,
    AgendaRecord,
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
    | { type: AgendaActionType.Complete; id: number; at?: string }
    | { type: AgendaActionType.Cancel; id: number };

export interface IAgendaExtractor {
    extract(messages: ChatMessage[], existingItems: AgendaRecord[]): Promise<AgendaAction[]>;
}

export const IAgendaExtractor = Symbol("IAgendaExtractor");
