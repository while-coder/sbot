import type { ChatMessage } from "../../Saver";
import type { PendingAgendaJobRow } from "../Storage/IAgendaStore";
import type {
    AgendaCreateArgs,
    AgendaCreateResult,
    AgendaListFilter,
    AgendaOccurrence,
    AgendaRecord,
    AgendaTriggerCreateArgs,
    AgendaTriggerReplaceAllArgs,
    AgendaTriggerUpdatePatch,
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
    /** 合并后的 trigger 工具描述：包含 add / update / remove / replace_all 四个 op 的统一说明。 */
    trigger: string;
    complete: string;
    cancel: string;
    /** agenda_wiki 工具被调用时返回的 body（决策性知识全集）。tool 自身的 description 短而稳定，inline 在 ToolProvider 里。 */
    wiki: string;
}

export interface IAgendaService {
    getToolDescs(): AgendaToolDescs;
    create(args: AgendaCreateArgs): Promise<AgendaCreateResult>;
    list(filter?: AgendaListFilter): Promise<AgendaRecord[]>;
    update(id: number, patch: AgendaUpdatePatch): Promise<AgendaRecord | null>;
    addTrigger(itemId: number, args: AgendaTriggerCreateArgs): Promise<AgendaRecord | null>;
    updateTrigger(triggerId: number, patch: AgendaTriggerUpdatePatch): Promise<AgendaRecord | null>;
    removeTrigger(triggerId: number): Promise<AgendaRecord | null>;
    replaceTriggers(itemId: number, args: AgendaTriggerReplaceAllArgs): Promise<AgendaRecord | null>;
    /**
     * 关一条 agenda。Occurrence 模式下可选 `at` 指定要关哪一次实例：
     * - 不传 at → 关最早的 pending（普通打卡语义）
     * - 传 at  → 在 pending + missed 中找 scheduledAt 最接近 at 的那条（支持补办）
     * 返回 null = item 不存在；否则返回 { record, closedOccurrence }，详见 AgendaCompleteResult。
     */
    complete(id: number, at?: string): Promise<AgendaCompleteResult | null>;
    cancel(id: number): Promise<AgendaRecord | null>;
    /**
     * 物理删除一条 agenda（连带 triggers / occurrences）。
     * 返回删除前的完整快照；找不到返回 null。
     * 仅 admin 路径用——LLM 工具走 cancel 不走 delete。
     */
    delete(id: number): Promise<AgendaRecord | null>;
    formatForLLM(filter?: AgendaListFilter): Promise<string>;

    /**
     * 每轮对话结束后同步触发：把消息快照入队 SQLite，触发后台串行抽取。
     * 调用方不需要 await 抽取完成；本方法只负责同步入队并唤醒后台处理。
     * channelSessionId 写到 pending job 行，drain 时回填到新 trigger 的 channelSessionId。
     */
    extractFromConversation(messages: ChatMessage[], channelSessionId: number): void;

    /** Pool 在 acquire 时调用：refCount++。仅 pool 用。 */
    incRef(): void;

    /**
     * Pool 在每次 acquire 时调用：单实例只真正跑一次（首次唤醒 drain 消化崩溃残留），
     * 并发 caller 共享同一个 promise；后续命中已 resolved 的 promise，零成本。
     */
    init(): Promise<void>;

    /**
     * caller 释放对 service 的引用：refCount--，归零时通知 pool 把自己从 cache 摘掉。
     * drain（checkJobs）自固定 refCount，所以 caller release 不会中断在跑的抽取。
     * 与 pool.acquire 配对调用：每次 acquire 必须对应一次 release。
     */
    release(): void;

    /** admin 触发：唤醒 pending job 队列消费（不阻塞，UI 通过 listPending 轮询进度）。 */
    processPending(): void;

    /** admin 排障：列最近的 pending+failed job（按 id DESC）。 */
    listPending(limit?: number): PendingAgendaJobRow[];
}

export const IAgendaService = Symbol("IAgendaService");
