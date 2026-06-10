import type {
    AgendaCreateArgs,
    AgendaItemView,
    AgendaUpdatePatch,
} from "../IAgendaService";

export type AgendaSyncAction =
    | { type: 'create'; args: AgendaCreateArgs }
    | { type: 'update'; id: number; patch: AgendaUpdatePatch }
    | { type: 'complete'; id: number }
    | { type: 'cancel'; id: number };

export interface IAgendaSyncExtractor {
    extract(userMessage: string, assistantMessages: string[], existingItems: AgendaItemView[]): Promise<AgendaSyncAction[]>;
}

export const IAgendaSyncExtractor = Symbol("IAgendaSyncExtractor");
