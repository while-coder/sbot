import type {
    AgendaCreateArgs,
    AgendaCreateResult,
    AgendaListFilter,
    AgendaRecord,
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
    list(filter?: AgendaListFilter): Promise<AgendaRecord[]>;
    update(id: number, patch: AgendaUpdatePatch): Promise<AgendaRecord | null>;
    complete(id: number): Promise<AgendaRecord | null>;
    cancel(id: number): Promise<AgendaRecord | null>;
    formatForLLM(filter?: AgendaListFilter): Promise<string>;
    extractFromConversation(userMessage: string, assistantMessages?: string[]): Promise<void>;
}

export const IAgendaService = Symbol("IAgendaService");
