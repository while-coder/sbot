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
    /**
     * 关一条 agenda。Occurrence 模式下可选 `at` 指定要关哪一次实例：
     * - 不传 at → 关最早的 pending（普通打卡语义）
     * - 传 at  → 在 pending（永远候选）+ missed（仅当 item.allowLateComplete）中找 scheduledAt 最接近 at 的那条
     */
    complete(id: number, at?: string): Promise<AgendaRecord | null>;
    cancel(id: number): Promise<AgendaRecord | null>;
    formatForLLM(filter?: AgendaListFilter): Promise<string>;
    extractFromConversation(userMessage: string, assistantMessages?: string[]): Promise<void>;
}

export const IAgendaService = Symbol("IAgendaService");
