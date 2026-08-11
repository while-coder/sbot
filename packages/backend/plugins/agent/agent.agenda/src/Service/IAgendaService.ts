import type { ChatMessage } from "scorpio.ai";
import type { PendingAgendaJobRow } from "../Storage/IAgendaStore";
import type { AgendaCloseOutcome } from "../types";
import type {
    AgendaCreateArgs,
    AgendaCreateResult,
    AgendaEditArgs,
    AgendaListFilter,
    AgendaRecord,
    AgendaTriggerCreateArgs,
    AgendaTriggerPatch,
    AgendaTriggerReplaceAllArgs,
    AgendaTriggerUpdatePatch,
    AgendaUpdatePatch,
} from "../types";

export interface AgendaToolDescs {
    create: string;
    list: string;
    /** agenda_get：list 之后按 id 取单条全文（trigger.message 完整执行指令 + 触发历史）。 */
    get: string;
    /** agenda_edit：主体字段 + trigger 增删改，一次调用原子生效。 */
    edit: string;
    /** agenda_close：done / dropped 统一终结入口。 */
    close: string;
    /** agenda_wiki 工具被调用时返回的 body（决策性知识全集）。tool 自身的 description 短而稳定，inline 在 ToolProvider 里。 */
    wiki: string;
}

export interface IAgendaService {
    getToolDescs(): AgendaToolDescs;
    create(args: AgendaCreateArgs): Promise<AgendaCreateResult>;
    list(filter?: AgendaListFilter): Promise<AgendaRecord[]>;
    update(id: number, patch: AgendaUpdatePatch): Promise<AgendaRecord | null>;
    /**
     * 主体字段 + trigger 增删改一次原子生效（LLM 侧 agenda_edit 的唯一入口）。
     * 细粒度的 update / addTrigger / patchTrigger / removeTrigger 仍保留给 admin REST 用。
     * patch/remove 的 trigger 必须属于该 item，否则抛错。
     */
    edit(id: number, args: AgendaEditArgs): Promise<AgendaRecord | null>;
    addTrigger(itemId: number, args: AgendaTriggerCreateArgs): Promise<AgendaRecord | null>;
    /** 整体覆盖一条 trigger（重置 fireCount / lastFiredAt）。admin REST 用；LLM 侧走 patchTrigger。 */
    updateTrigger(triggerId: number, patch: AgendaTriggerUpdatePatch): Promise<AgendaRecord | null>;
    /**
     * 部分更新一条 trigger：只改传入的字段，**保留** fireCount / lastFiredAt。
     * 改 kind 必须同时给新 kind 的 schedule 字段，否则抛错（expr 语义会与 kind 错位）。
     */
    patchTrigger(triggerId: number, patch: AgendaTriggerPatch): Promise<AgendaRecord | null>;
    removeTrigger(triggerId: number): Promise<AgendaRecord | null>;
    /**
     * 物理删除单条 trigger（区别于 removeTrigger 的软停用），并撤掉其内存 timer。
     * 返回所属 item 的最新记录；trigger 不存在返回 null。仅 admin 路径用。
     */
    deleteTrigger(triggerId: number): Promise<AgendaRecord | null>;
    replaceTriggers(itemId: number, args: AgendaTriggerReplaceAllArgs): Promise<AgendaRecord | null>;
    /**
     * 终结一条 agenda（LLM 侧 agenda_close 的入口）。
     * done / dropped 落库效果相同——整条置终态 + disable 所有 trigger，差别只在 status 记录的意图。
     * at 仅 done 有意义：回填真实完成时刻。item 不存在返回 null。
     */
    close(id: number, outcome: AgendaCloseOutcome, at?: string): Promise<AgendaRecord | null>;
    /**
     * 完成一条 agenda：整条置 Done 并 disable 所有 trigger。
     * 返回 null = item 不存在；否则返回置 Done 后的记录。admin REST 用；LLM 侧走 close。
     */
    complete(id: number): Promise<AgendaRecord | null>;
    /** 取消一条 agenda。admin REST 用；LLM 侧走 close(dropped)。 */
    cancel(id: number): Promise<AgendaRecord | null>;
    /**
     * 终态的逆操作（仅 item 层）：把 Cancelled/Done/Expired 的条目恢复为 Pending。
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
    /** agenda_list 的渲染：清单视图，trigger.message 只给预览。 */
    formatForLLM(filter?: AgendaListFilter): Promise<string>;
    /**
     * agenda_get 的渲染：单条完整视图——message 全文 + 停用的 trigger + 时间戳，
     * fires=true 时附最近 DETAIL_FIRES_LIMIT 条触发历史。
     * item 不存在时返回 "Agenda #id not found." 而非抛错（直接回给 LLM 当工具结果）。
     */
    formatDetailForLLM(id: number, opts?: { fires?: boolean }): Promise<string>;

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
