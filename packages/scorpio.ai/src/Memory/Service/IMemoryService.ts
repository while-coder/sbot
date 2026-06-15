import type { MemorySearchHit, MemoryRow, PendingMessageRow } from "../Storage/IMemoryStore";
import type { ChatMessage } from "../../Saver";

/**
 * Memory 系统对外接口。运行时由 SingleAgentService 持有：
 *
 * - **读注入**：`getMemoryMenuPrompt()` 渲染好的 markdown 块注入 system prompt
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
     */
    getMemoryMenuPrompt(): Promise<string>;

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
     * 调用方不需要 await 抽取完成；本方法本身仅 await DB 写入即返回。
     */
    extractFromConversation(messages: ChatMessage[]): Promise<void>;

    /** admin 排障：列最近的 pending+failed 行（按 id DESC）。 */
    listPending(limit?: number): Promise<PendingMessageRow[]>;

    /** admin 触发：强制扫描 pending 队列并阻塞等待消费完成。 */
    processPending(): Promise<void>;

    /** admin 触发：合并/压缩现有 memory 条目。 */
    consolidate(): Promise<MemoryWriterOpStats>;

    /**
     * 上层（pool）通知：本 service 准备释放。
     * - 仅设置标记 + 唤醒抽取循环；不阻塞调用方；
     * - 待 pending 队列抽干后由实现主动回调构造时注入的 onRelease；
     * - drain 期间若被新 acquire 抬高 refCount，pool 在 onRelease 内二次校验拒绝 dispose。
     */
    requestRelease?(): void;
}

export const IMemoryService = Symbol("IMemoryService");
