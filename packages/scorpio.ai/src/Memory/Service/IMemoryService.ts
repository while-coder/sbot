import type { MemorySearchHit, MemoryRow, PendingMemoryJobRow } from "../Storage/IMemoryStore";
import type { ChatMessage } from "../../Saver";

/**
 * Memory 系统对外接口。运行时由 SingleAgentService 持有：
 *
 * - **读注入**：`getSystemMessage()` 渲染好的 markdown 块注入 system prompt
 * - **工具调用**：`readMemory(slug)` / `search(query)` 由 `read_memory` / `search_memory` 工具执行
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
    readMemory(slug: string): Promise<MemoryRow | null>;

    /**
     * BM25 全文检索。
     * limit 默认 10，floorRatio 默认 0.15。
     */
    search(query: string, limit?: number): Promise<MemorySearchHit[]>;

    /** 工具描述（注入到 read_memory / search_memory 工具的 description 字段）。 */
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
    deleteMemory(slug: string): Promise<string>;

    /**
     * admin 重新对账：扫描 memories/ 下的 .md 文件，同步进 SQLite 索引。
     * 用于"手写 / 外部编辑 .md 文件后让索引立即生效"的场景。
     * 返回 { indexed, pruned } 计数。
     */
    reconcile(): Promise<{ indexed: number; pruned: number }>;

    /**
     * 每轮对话结束后同步触发：把消息快照入队 SQLite，触发后台串行抽取。
     * 调用方不需要 await 抽取完成；本方法只负责同步入队并唤醒后台处理。
     */
    extractFromConversation(messages: ChatMessage[]): void;

    /** admin 排障：列最近的 pending+failed job（按 id DESC）。 */
    listPending(limit?: number): PendingMemoryJobRow[];

    /** admin 触发：唤醒 pending job 队列消费（不阻塞，UI 通过 listPending 轮询进度）。 */
    processPending(): void;

    /** admin 触发：把合并/压缩现有 memory 条目的 job 入队。 */
    enqueueConsolidate(): number;

    /** admin 触发：重试一条 failed extract job。返回 false 表示 job 不可重试。 */
    retryExtractJob(id: number): boolean;

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
