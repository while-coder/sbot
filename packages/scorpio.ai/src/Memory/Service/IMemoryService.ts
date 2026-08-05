import type { MemoryScope, MemorySearchHit, MemoryRow, PendingMemoryJobRow } from "../Storage/IMemoryStore";
import type { ChatMessage } from "../../Saver";

/**
 * Memory 系统对外接口。运行时由 SingleAgentService 持有：
 *
 * - **读注入**：`getSystemMessage()` 渲染好的 markdown 块注入 system prompt
 * - **工具调用**：`readMemory(slug, scope)` / `search(query)` 由 `read_memory` / `search_memory` 工具执行
 * - **写路径**：`extractFromConversation(messages)` 每轮对话结束触发；
 *   实现内部把消息推入 SQLite 队列并串行调度 LLM 抽取。
 */

export interface MemoryToolDescs {
    /** read_memory 工具描述 */
    read: string;
    /** search_memory 工具描述 */
    search: string;
}

export interface MemoryWriterOpStats {
    create: number;
    update: number;
    delete: number;
    noop: number;
    failed: number;
}

export interface IMemoryService {
    /**
     * 注入到主 agent system prompt 的整段记忆指引：
     *
     *   - 渲染 `memory/reader/default.md` 模板（替换 `{{ memory_menu }}`）
     *   - 含当前 menu 列表 + 工具调用规则
     *
     * 无 memory 时仍返回模板（让 agent 知道工具存在，只是当前空），由调用方决定是否注入。
     * 返回 null 留给将来扩展（与 Note/Wiki/Skill 的 getSystemMessage 签名对齐）。
     */
    getSystemMessage(): Promise<string | null>;

    /**
     * 按 slug 取 memory 全文。
     * - 命中：累加 read_count、刷新 lastReadAt
     * - 未命中：返回 null
     */
    readMemory(slug: string, scope: MemoryScope): Promise<MemoryRow | null>;

    /**
     * BM25 全文检索。
     * limit 默认 10，floorRatio 默认 0.15。
     */
    search(query: string, limit?: number): Promise<MemorySearchHit[]>;

    /**
     * 用户显式要求保存时使用：把消息持久化到 extract 队列并返回 job id。
     * 消费时绕过 Selector 的 shouldWrite 否决，并把 mutation 锁定到 requested scope。
     */
    remember(content: string, scope: MemoryScope): Promise<number>;

    /** read_memory / search_memory 的工具描述。 */
    getToolDescs(): MemoryToolDescs;

    /**
     * admin 浏览用：列所有 memory（不分页）。
     * 注意：返回完整 MemoryRow（含 body），数量大时调用方自行截断。
     */
    listAll(): Promise<MemoryRow[]>;

    /**
     * admin 删除单条 memory：软删除（文件移到 .archive/，DB 行 DELETE）。
     * slug 不存在抛错。返回 archive 文件名。
     */
    deleteMemory(slug: string, scope: MemoryScope): Promise<string>;

    /**
     * 每轮对话结束后同步触发：把消息快照入队 SQLite，触发后台串行抽取。
     * 调用方不需要 await 抽取完成；本方法只负责同步入队并唤醒后台处理。
     */
    extractFromConversation(messages: ChatMessage[]): void;

    /** admin 排障：列最近的 pending+failed job（按 id DESC）。 */
    listPending(limit?: number): PendingMemoryJobRow[];

    /** admin 将一条 failed job 重新放回 pending 队列。 */
    retryFailedJob(id: number): boolean;

    /** admin 删除一条 failed job；pending/processing 不允许删除。 */
    deleteFailedJob(id: number): boolean;

    /** admin 触发：把合并/压缩现有 memory 条目的 job 入队。 */
    enqueueConsolidate(): number;

    /** admin 触发：把 FS/DB 对账 job 入队。 */
    enqueueReconcile(): number;

    /**
     * caller 释放对 service 的引用：refCount--，归零时关 SQLite store 并通知 pool
     * 把自己从 cache 摘掉。drain（checkJobs）自固定 refCount，所以 caller
     * release 不会中断在跑的抽取。
     *
     * 与 pool.acquire 配对调用：每次 acquire 必须对应一次 release。
     */
    release(): void;
}

export const IMemoryService = Symbol("IMemoryService");
