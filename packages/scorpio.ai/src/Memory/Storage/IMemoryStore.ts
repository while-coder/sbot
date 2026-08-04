import type { ChatMessage } from "../../Saver";

/**
 * Memory 存储层接口。单 Store 维度：全局或某个 workPath 各自对应一个 SQLite 文件
 * + 一个 memories 目录（FS 是真源，DB 是 FTS 索引）。MemoryService 在 profile 上层协调多个 Store。
 *
 * 三类操作：
 * - CRUD：MemoryWriter 写入路径用（create / update / delete / get / list）
 * - 检索：search_memory / read_memory 工具调用（search + getBySlug + recordRead）
 * - 待处理 job 队列：抽取/整理入队，MemoryService 串行消费
 *
 * delete 是软删除：文件移到 `memories/.archive/<slug>.md`，DB 行删除。
 * archived 文件由后台 cron 30 天后清理（不在本接口范围内）。
 */

export enum MemoryKind {
    Preference = 'preference',
    Fact = 'fact',
    Workflow = 'workflow',
    Project = 'project',
    Decision = 'decision',
    Summary = 'summary',
}

/** MemoryService 对外暴露的两层作用域。 */
export enum MemoryScope {
    Global = 'global',
    Workspace = 'workspace',
}

/** 一个规范化后的工作目录作用域；key 用于磁盘目录，path 只用于展示与 prompt。 */
export interface MemoryWorkspaceScope {
    key: string;
    path: string;
}

/** 所有需要选择全局/工作区的写入与队列操作都必须显式携带目标。 */
export type MemoryTarget =
    | { scope: MemoryScope.Global }
    | { scope: MemoryScope.Workspace; workspace: MemoryWorkspaceScope };

export interface StoredMemoryRow {
    id: number;
    slug: string;
    /** 轻量类型，用于 menu 分组、整理和后续筛选。 */
    kind: MemoryKind;
    /**
     * 条目的唯一标签：文件首行 H1（不含 `# ` 前缀），同时是注入 system prompt menu 的那一行。
     * 因此它是一句摘要而非分类标题——reader 在 menu 里看不到 body。
     * 存在文件里而不只在 DB，删库重建（reconcile）可无损恢复。
     */
    title: string;
    /** 完整文件内容（含 `# title` H1 + 正文），FTS 索引此字段 */
    body: string;
    /** 内容 sha256，reconcile 用 */
    fingerprint: string;
    /**
     * 被多少次独立**对话**抽取佐证过，用于整理和置信度排序。
     * 只有抽取路径 +1；consolidate 的整理性重写不算（见 MemoryService.ApplyOpsContext）——
     * 否则一轮整理就能把全库抬高一档，注入给 agent 的 evidence=N 随之失去意义。
     */
    evidenceCount: number;
    createdAt: number;
    updatedAt: number;
    /** read_memory / search_memory 命中时刷新；用于 menu 注入排序 */
    lastReadAt: number | null;
    readCount: number;
}

/** MemoryService 对外返回的行必须明确作用域。 */
export interface MemoryRow extends StoredMemoryRow {
    scope: MemoryScope;
}

export interface StoredMemoryMenuEntry {
    slug: string;
    kind: MemoryKind;
    title: string;
    evidenceCount: number;
}

export interface MemoryMenuEntry extends StoredMemoryMenuEntry {
    scope: MemoryScope;
}

export interface StoredMemorySearchHit {
    slug: string;
    kind: MemoryKind;
    /**
     * 与 MemoryMenuEntry 同字段——system prompt 的 menu 和 search 结果
     * 必须用同一个标签描述同一条记忆，否则 agent 得靠 slug 自己认亲。
     */
    title: string;
    /** 佐证次数。同上，menu 里显示 evidence=N，search 结果也给。 */
    evidenceCount: number;
    /** FTS5 snippet，匹配片段 */
    snippet: string;
    /**
     * higher = better（已对 BM25 取负）。
     * 排序内部用 + admin/排障用，**不渲染给 LLM**：归一化前的分数跨查询不可比，
     * agent 拿它做不了判断，而"best first"已经把排序信息说完了。
     */
    score: number;
}

export interface MemorySearchHit extends StoredMemorySearchHit {
    scope: MemoryScope;
}

export interface CreateMemoryInput {
    slug: string;
    kind?: MemoryKind;
    title: string;
    body: string;
    evidenceCount?: number;
}

export type MemoryBodyMode = 'replace' | 'append';

export interface UpdateMemoryInput {
    slug: string;
    kind?: MemoryKind;
    title?: string;
    body?: string;
    bodyMode?: MemoryBodyMode;
    evidenceDelta?: number;
}

// ── 待处理 job 队列 ──

export enum MemoryPendingJobType {
    Extract = 'extract',
    Consolidate = 'consolidate',
    Reconcile = 'reconcile',
}

export type MemoryPendingJobStatus = 'pending' | 'failed';

interface PendingMemoryJobBase {
    id: number;
    type: MemoryPendingJobType;
    messages?: ChatMessage[];
    status: MemoryPendingJobStatus;
    attemptCount: number;
    errorMessage: string | null;
    createdAt: number;
    updatedAt: number;
}

/** scope=workspace 时 workspace 必传；全局任务不携带伪 workPath。 */
export type PendingMemoryJobRow = PendingMemoryJobBase & (
    | { scope: MemoryScope.Global }
    | { scope: MemoryScope.Workspace; workspace: MemoryWorkspaceScope }
);

export interface IMemoryStore {
    readonly rootDir: string;
    readonly memoriesDir: string;
    readonly archiveDir: string;

    // ── CRUD ──

    /**
     * 创建。同时写文件 `memories/<slug>.md` 和 DB 行。
     * slug 已存在则抛错（调用方负责事先 list / get 检查）。
     */
    create(input: CreateMemoryInput, now: number): Promise<StoredMemoryRow>;

    /**
     * 更新（部分字段）。重写文件 + 更新 DB。
     * slug 不存在抛错。
     */
    update(input: UpdateMemoryInput, now: number): Promise<StoredMemoryRow>;

    /**
     * 软删除：移文件到 `memories/.archive/<slug>-<now>.md` + DB DELETE。
     * slug 不存在抛错。返回 archive 文件名。
     */
    softDelete(slug: string, now: number): Promise<string>;

    getBySlug(slug: string): Promise<StoredMemoryRow | null>;

    list(): Promise<StoredMemoryRow[]>;

    /** 注入 system prompt 用：拉所有 entry 的 slug + title，按 lastReadAt DESC, updatedAt DESC 排，截断到 limit。 */
    listMenu(limit: number): Promise<StoredMemoryMenuEntry[]>;

    // ── 检索 ──

    /**
     * BM25 全文检索。
     * - query 为空 / 提取不到 token 返回 []
     * - 先按 score 排序、再用 floorRatio 过滤 common-word 噪音（floor 0 = 不过滤）
     * - over-fetch 3x（最多 50）后再裁到 limit
     */
    search(query: string, limit: number, floorRatio: number): Promise<StoredMemorySearchHit[]>;

    /** read_memory 命中时调用：lastReadAt = now, readCount += 1。slug 不存在 no-op。 */
    recordRead(slug: string, now: number): Promise<void>;

    // ── 对账（reconcile）──

    /**
     * FS 与 DB 对账。允许外部进程编辑 / 删除 .md 文件不破坏索引。
     *
     * 双向：
     * - DB 行的 path 不在 FS → 删 DB
     * - FS 文件不在 DB / fingerprint 变化 → upsert 到 DB（重新解析 title）
     *
     * 返回 { indexed, pruned } 计数。
     */
    reconcile(): Promise<{ indexed: number; pruned: number }>;

    // ── 待处理 job 队列（每轮对话结束抽取、手动整理、手动对账等入队后串行消费） ──
    // 全部同步：底层 better-sqlite3 是同步 API；MemoryService 依赖
    // "push 的 SQL 在 kick 前已落库" 这一点来避免漏单。

    /** 入队一轮对话的消息快照，返回插入行 id。 */
    pushPendingMessages(messages: ChatMessage[], now: number, target: MemoryTarget): number;

    /** 入队一次 memory 整理 job，返回插入行 id。 */
    pushPendingConsolidate(now: number, target: MemoryTarget): number;

    /** 入队一次 FS/DB 对账 job，返回插入行 id。 */
    pushPendingReconcile(now: number, target: MemoryTarget): number;

    /** 取最早一条 status='pending' 的 job；没有返回 null。串行消费由 MemoryService 内部 isRunning 标志保证。 */
    popPendingJob(): PendingMemoryJobRow | null;

    /** 删除一行（成功消费后调用）。 */
    deletePendingJob(id: number): void;

    /** 标记失败（保留数据），attemptCount += 1。 */
    markPendingJobFailed(id: number, errorMessage: string, now: number): void;

    /** 将 failed 的抽取 job 重新放回 pending 队列。返回 false 表示不是可重试的 failed extract job。 */
    retryFailedExtractJob(id: number, now: number): boolean;

    /**
     * 管理/排障用：列最近的 pending+failed job（按 id DESC）。
     * target 必传；全局和工作区查询不再由缺省 workspaceKey 推断。
     * 过滤必须在 SQL LIMIT 之前完成，避免某个作用域的近期 job 挤掉目标作用域。
     */
    listPendingJobs(limit: number, target: MemoryTarget): PendingMemoryJobRow[];

    dispose(): void;

    /**
     * 物理删除：rm `rootDir`（含 memories/、.archive/、searcher.sqlite）+ dbPath。
     * 调用前必须 dispose() —— 否则 sqlite handle 仍开着，Windows 上 rm 会因文件锁失败。
     * 仅在 profile 删除路径调用，由 MemoryService.markForDeletion() 触发。
     */
    deleteAll(): Promise<void>;
}

export const IMemoryStore = Symbol("IMemoryStore");
