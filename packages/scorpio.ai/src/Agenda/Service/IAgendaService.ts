import type {
    AgendaCreateArgs,
    AgendaCreateResult,
    AgendaItemView,
    AgendaListFilter,
    AgendaUpdatePatch,
} from "../types";

export interface AgendaToolDescs {
    create: string;
    list: string;
    update: string;
    complete: string;
    cancel: string;
}

export interface IAgendaService {
    getToolDescs(): AgendaToolDescs;
    create(args: AgendaCreateArgs): Promise<AgendaCreateResult>;
    list(filter?: AgendaListFilter): Promise<AgendaItemView[]>;
    update(id: number, patch: AgendaUpdatePatch): Promise<AgendaItemView | null>;
    complete(id: number): Promise<AgendaItemView | null>;
    cancel(id: number): Promise<AgendaItemView | null>;
    formatForLLM(filter?: AgendaListFilter): Promise<string>;
    extractFromConversation(userMessage: string, assistantMessages?: string[]): Promise<void>;
}

export const IAgendaService = Symbol("IAgendaService");
