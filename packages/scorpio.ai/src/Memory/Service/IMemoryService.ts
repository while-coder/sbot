import type { MemorySearchHit, MemoryRow, PendingMessageRow } from "../Storage/IMemoryStore";
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
     * 每轮对话结束后同步触发：把消息快照入队 SQLite，触发后台串行抽取。
     * 调用方不需要 await 抽取完成；本方法只负责同步入队并唤醒后台处理。
     */
    extractFromConversation(messages: ChatMessage[]): void;

    /** admin 排障：列最近的 pending+failed 行（按 id DESC）。 */
    listPending(limit?: number): PendingMessageRow[];

    /** admin 触发：唤醒 pending 队列消费（不阻塞，UI 通过 listPending 轮询进度）。 */
    processPending(): void;

    /** admin 触发：合并/压缩现有 memory 条目。 */
    consolidate(): Promise<MemoryWriterOpStats>;

    /**
     * 上层（pool）通知：本 service 准备销毁。
     * - 仅设置标记 + 唤醒抽取循环；不阻塞调用方；
     * - 待 pending 队列抽干后由实现主动回调 pool 单例的 notifyServiceIdle，
     *   pool 据此关闭 store 并移出缓存。
     * - 通常由 pool.invalidate / disposeAll 触发；caller 一般不直接调。
     */
    dispose?(): void;
}

export const IMemoryService = Symbol("IMemoryService");
