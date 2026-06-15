import type { ChatMessage } from "../../Saver";

/**
 * Memory 存储层接口。单 memoryProfile 维度：每个 profile 对应一个 SQLite 文件
 * + 一个 memories 目录（FS 是真源，DB 是 FTS 索引）。
 *
 * 三类操作：
 * - CRUD：MemoryWriter 写入路径用（create / update / delete / get / list）
 * - 检索：search_memory / read_memory 工具调用（search + getBySlug + recordRead）
 * - 待处理消息队列：每轮对话结束入队，MemoryService.checkMessages 串行消费
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

export interface MemoryRow {
    id: number;
    slug: string;
    /** 轻量类型，用于 menu 分组、整理和后续筛选。 */
    kind: MemoryKind;
    /** 文件首行 H1（不含 `# ` 前缀） */
    title: string;
    /** 一行摘要，用于注入 system prompt menu */
    description: string;
    /** 完整文件内容（含 `# title` H1 + 正文），FTS 索引此字段 */
    body: string;
    /** size-mtime，reconcile 用 */
    fingerprint: string;
    /** 被多少次独立抽取佐证/更新过，用于整理和置信度排序。 */
    evidenceCount: number;
    createdAt: number;
    updatedAt: number;
    /** read_memory / search_memory 命中时刷新；用于 menu 注入排序 */
    lastReadAt: number | null;
    readCount: number;
}

export interface MemoryMenuEntry {
    slug: string;
    kind: MemoryKind;
    title: string;
    description: string;
    evidenceCount: number;
}

export interface MemorySearchHit {
    slug: string;
    kind: MemoryKind;
    title: string;
    /** FTS5 snippet，匹配片段 */
    snippet: string;
    /** higher = better（已对 BM25 取负） */
    score: number;
}

export interface CreateMemoryInput {
    slug: string;
    kind?: MemoryKind;
    title: string;
    description: string;
    body: string;
    evidenceCount?: number;
}

export type MemoryBodyMode = 'replace' | 'append';

export interface UpdateMemoryInput {
    slug: string;
    kind?: MemoryKind;
    title?: string;
    description?: string;
    body?: string;
    bodyMode?: MemoryBodyMode;
    evidenceDelta?: number;
}

// ── 待处理消息队列 ──

export type PendingMessageStatus = 'pending' | 'failed';

export interface PendingMessageRow {
    id: number;
    messages: ChatMessage[];
    status: PendingMessageStatus;
    attemptCount: number;
    errorMessage: string | null;
    createdAt: number;
    updatedAt: number;
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

    // ── 待处理消息队列（每轮对话结束入队，串行消费） ──
    // 全部同步：底层 better-sqlite3 是同步 API；MemoryService 依赖
    // "push 的 SQL 在 kick 前已落库" 这一点来避免漏单。

    /** 入队一轮对话的消息快照，返回插入行 id。 */
    pushPendingMessages(messages: ChatMessage[], now: number): number;

    /** 取最早一条 status='pending' 的行；没有返回 null。串行消费由 MemoryService 内部 isRunning 标志保证。 */
    popPendingMessages(): PendingMessageRow | null;

    /** 删除一行（成功消费后调用）。 */
    deletePending(id: number): void;

    /** 标记失败（保留数据），attemptCount += 1。 */
    markPendingFailed(id: number, errorMessage: string, now: number): void;

    /** 管理/排障用：列最近的 pending+failed 行（按 id DESC）。 */
    listPendingMessages(limit: number): PendingMessageRow[];

    dispose(): void;
}

export const IMemoryStore = Symbol("IMemoryStore");
