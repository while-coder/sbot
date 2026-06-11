/**
 * Memory 存储层接口。单 memoryProfile 维度：每个 profile 对应一个 SQLite 文件
 * + 一个 memories 目录（FS 是真源，DB 是 FTS 索引）。
 *
 * 三类操作：
 * - CRUD：MemoryWriter 写入路径用（create / update / delete / get / list）
 * - 检索：search_memory / read_memory 工具调用（search + getBySlug + recordRead）
 * - 调度：MemoryWriter 触发用的 transcript job 队列（enqueue / claim / finish）
 *
 * delete 是软删除：文件移到 `memories/.archive/<slug>.md`，DB 行删除。
 * archived 文件由后台 cron 30 天后清理（不在本接口范围内）。
 */

export interface MemoryRow {
    id: number;
    slug: string;
    /** 文件首行 H1（不含 `# ` 前缀） */
    title: string;
    /** 一行摘要，用于注入 system prompt menu */
    description: string;
    /** 完整文件内容（含 `# title` H1 + 正文），FTS 索引此字段 */
    body: string;
    /** size-mtime，reconcile 用 */
    fingerprint: string;
    createdAt: number;
    updatedAt: number;
    /** read_memory / search_memory 命中时刷新；用于 menu 注入排序 */
    lastReadAt: number | null;
    readCount: number;
}

export interface MemoryMenuEntry {
    slug: string;
    title: string;
    description: string;
}

export interface MemorySearchHit {
    slug: string;
    title: string;
    /** FTS5 snippet，匹配片段 */
    snippet: string;
    /** higher = better（已对 BM25 取负） */
    score: number;
}

export interface CreateMemoryInput {
    slug: string;
    title: string;
    description: string;
    body: string;
}

export interface UpdateMemoryInput {
    slug: string;
    title?: string;
    description?: string;
    body?: string;
}

// ── transcript 抽取队列 ──

export type ExtractJobStatus = 'pending' | 'claimed' | 'succeeded' | 'failed';

export interface ExtractJobRow {
    id: number;
    threadId: string;
    rolloutKey: string;
    windowStartCursor: string;
    windowEndCursor: string;
    turnCount: number;
    status: ExtractJobStatus;
    attemptCount: number;
    nextRetryAt: number | null;
    leasedAt: number | null;
    leaseExpiresAt: number | null;
    finishedAt: number | null;
    errorMessage: string | null;
    createdAt: number;
}

export interface EnqueueExtractInput {
    threadId: string;
    rolloutKey: string;
    windowStartCursor: string;
    windowEndCursor: string;
    turnCount: number;
}

export interface IMemoryStore {
    readonly rootDir: string;
    readonly memoriesDir: string;
    readonly archiveDir: string;

    /** 创建目录 + 初始化 DB schema。幂等。 */
    init(): Promise<void>;

    // ── CRUD ──

    /**
     * 创建。同时写文件 `memories/<slug>.md` 和 DB 行。
     * slug 已存在则抛错（调用方负责事先 list / get 检查）。
     */
    create(input: CreateMemoryInput, now: number): Promise<MemoryRow>;

    /**
     * 更新（部分字段）。重写文件 + 更新 DB。
     * slug 不存在抛错。
     */
    update(input: UpdateMemoryInput, now: number): Promise<MemoryRow>;

    /**
     * 软删除：移文件到 `memories/.archive/<slug>-<now>.md` + DB DELETE。
     * slug 不存在抛错。返回 archive 文件名。
     */
    softDelete(slug: string, now: number): Promise<string>;

    getBySlug(slug: string): Promise<MemoryRow | null>;

    list(): Promise<MemoryRow[]>;

    /** 注入 system prompt 用：拉所有 entry 的 slug + title + description，按 lastReadAt DESC, updatedAt DESC 排，截断到 limit。 */
    listMenu(limit: number): Promise<MemoryMenuEntry[]>;

    // ── 检索 ──

    /**
     * BM25 全文检索。
     * - query 为空 / 提取不到 token 返回 []
     * - 先按 score 排序、再用 floorRatio 过滤 common-word 噪音（floor 0 = 不过滤）
     * - over-fetch 3x（最多 50）后再裁到 limit
     */
    search(query: string, limit: number, floorRatio: number): Promise<MemorySearchHit[]>;

    /** read_memory 命中时调用：lastReadAt = now, readCount += 1。slug 不存在 no-op。 */
    recordRead(slug: string, now: number): Promise<void>;

    // ── 对账（reconcile）──

    /**
     * FS 与 DB 对账。允许外部进程编辑 / 删除 .md 文件不破坏索引。
     *
     * 双向：
     * - DB 行的 path 不在 FS → 删 DB
     * - FS 文件不在 DB / fingerprint 变化 → upsert 到 DB（重新解析 title/description）
     *
     * 返回 { indexed, pruned } 计数。
     */
    reconcile(): Promise<{ indexed: number; pruned: number }>;

    // ── transcript 抽取队列 ──

    /** 入队。rolloutKey 已存在返回 null。 */
    enqueueExtract(input: EnqueueExtractInput, now: number): Promise<ExtractJobRow | null>;

    findExtractJob(id: number): Promise<ExtractJobRow | null>;

    /** 抢占可执行 job：pending、过期 claimed、failed 且 nextRetryAt<=now。事务内 SELECT+UPDATE。 */
    claimExtract(now: number, leaseMs: number, limit: number): Promise<ExtractJobRow[]>;

    finishExtractSuccess(id: number, now: number): Promise<void>;

    finishExtractFailure(id: number, errorMessage: string, nextRetryAt: number | null, now: number): Promise<void>;

    /**
     * 给定 thread，找出已"完成处理"窗口（succeeded）中 windowEndCursor 最大的那个。
     * 失败/重试中的 job 不算。返回 null 表示该 thread 还没处理过任何窗口。
     */
    findLatestCompletedWindowEnd(threadId: string): Promise<string | null>;

    dispose(): void;
}

export const IMemoryStore = Symbol("IMemoryStore");
