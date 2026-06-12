import type {
    AgendaCreateArgs,
    AgendaCreateResult,
    AgendaListFilter,
    AgendaOccurrence,
    AgendaRecord,
    AgendaUpdatePatch,
} from "../types";

/**
 * complete() 的返回值。
 * - record: 关闭后整条 agenda 的最新快照
 * - closedOccurrence: 仅 Occurrence 模式有意义；本次实际关闭的实例，**保留关闭前的 status/doneAt**
 *   方便调用方报告"实际关了哪一条、关之前是 pending 还是 missed"
 *   null = 非 occurrence 模式，或 occurrence 模式下没找到匹配
 */
export interface AgendaCompleteResult {
    record: AgendaRecord;
    closedOccurrence: AgendaOccurrence | null;
}

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
     * - 传 at  → 在 pending + missed 中找 scheduledAt 最接近 at 的那条（支持补办）
     * 返回 null = item 不存在；否则返回 { record, closedOccurrence }，详见 AgendaCompleteResult。
     */
    complete(id: number, at?: string): Promise<AgendaCompleteResult | null>;
    cancel(id: number): Promise<AgendaRecord | null>;
    formatForLLM(filter?: AgendaListFilter): Promise<string>;
    extractFromConversation(userMessage: string, assistantMessages?: string[]): Promise<void>;
}

export const IAgendaService = Symbol("IAgendaService");
