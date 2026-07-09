import type { ChatMessage } from "../../Saver";
import type { PendingAgendaJobRow } from "../Storage/IAgendaStore";
import type {
    AgendaCreateArgs,
    AgendaCreateResult,
    AgendaListFilter,
    AgendaRecord,
    AgendaTriggerCreateArgs,
    AgendaTriggerReplaceAllArgs,
    AgendaTriggerUpdatePatch,
    AgendaUpdatePatch,
} from "../types";

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
    /**
     * 物理删除单条 trigger（区别于 removeTrigger 的软停用），并撤掉其内存 timer。
     * 返回所属 item 的最新记录；trigger 不存在返回 null。仅 admin 路径用。
     */
    deleteTrigger(triggerId: number): Promise<AgendaRecord | null>;
    replaceTriggers(itemId: number, args: AgendaTriggerReplaceAllArgs): Promise<AgendaRecord | null>;
    /**
     * 完成一条 agenda：整条置 Done 并 disable 所有 trigger。
     * 返回 null = item 不存在；否则返回置 Done 后的记录。
     */
    complete(id: number): Promise<AgendaRecord | null>;
    cancel(id: number): Promise<AgendaRecord | null>;
    /**
     * cancel() 的逆操作（仅 item 层）：把 Cancelled/Done 的条目恢复为 Pending。
     * **不**连带复活触发器——它们保持停用，由 reopenTrigger 逐条按需启用。
     * 已是 Pending 时幂等返回。仅 admin 路径用——LLM 工具不暴露。item 不存在返回 null。
     */
    reopen(id: number): Promise<AgendaRecord | null>;
    /**
     * removeTrigger（软停用）的逆操作：重新启用单条 trigger 并重算 nextFireAt。
     * 所属 item 非 Pending 时引擎 reload 会把它重新停用（需先 reopen item）；
     * 已耗尽（达 maxFires）的会重置 fireCount。返回所属 item 最新记录；trigger 不存在返回 null。
     * 仅 admin 路径用。
     */
    reopenTrigger(triggerId: number): Promise<AgendaRecord | null>;
    /**
     * 物理删除一条 agenda（连带 triggers / trigger_fire 日志）。
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
