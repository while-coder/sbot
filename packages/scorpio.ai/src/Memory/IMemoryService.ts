import type { MemorySearchHit, MemoryRow } from "./IMemoryStore";

/**
 * Memory 系统对外接口。运行时由 SingleAgentService 持有：
 *
 * - **读注入**：`getMemoryMenuPrompt()` 渲染好的 markdown 块注入 system prompt
 * - **工具调用**：`readMemory(slug)` / `search(query)` 由 `read_memory` / `search_memory` 工具执行
 *
 * 写路径不在本接口暴露，由后台 MemoryWriterWorker 跑，对 user agent 透明。
 */

export interface MemoryToolDescs {
    /** read_memory 工具描述 */
    read: string;
    /** search_memory 工具描述 */
    search: string;
}

export interface IMemoryService {
    /**
     * 注入到主 agent system prompt 的整段记忆指引：
     *
     *   - 渲染 `memory_read.md` 模板（替换 `{{ memory_menu }}`）
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
}

export const IMemoryService = Symbol("IMemoryService");
