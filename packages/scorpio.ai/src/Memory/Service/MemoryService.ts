import { z } from "zod";
import { inject } from "scorpio.di";
import {
    T_MemoryReadTemplate,
    T_MemoryWriterPrompt,
} from "../../Core/tokens";
import { formatError } from "../../Core";
import { ILogger, ILoggerService } from "../../Logger";
import { IModelService } from "../../Model";
import {
    IMemoryService,
    type MemoryToolDescs,
    type MemoryWriterOpStats,
} from "./IMemoryService";
import {
    IMemoryStore,
    MemoryKind,
    type MemoryRow,
    type MemorySearchHit,
    type MemoryBodyMode,
    MemoryPendingJobType,
    type PendingMemoryJobRow,
} from "../Storage/IMemoryStore";
import { type ChatMessage, MessageRole } from "../../Saver";
import { contentToString, truncateForLog } from "../../Utils/contentUtils";
import { renderConversation } from "../../Utils/conversationUtils";
import { memoryServicePool } from "./MemoryServicePool";

// 读路径（每轮注入 system prompt）—— 高频常驻成本，截到 evidence/recency 排序里的头部就够，
// 模型未命中时还有 search_memory 工具兜底。
const DEFAULT_READ_MENU_LIMIT = 50;
// 写路径（writer LLM 单次抽取）—— 单次成本，需要更广的覆盖来判断 create/update 去重。
const DEFAULT_WRITER_MENU_LIMIT = 200;
const DEFAULT_SEARCH_LIMIT = 10;
const DEFAULT_SCORE_FLOOR = 0.15;

const DEFAULT_TOOL_DESCS: MemoryToolDescs = {
    read: [
        "Read the full content of a long-term memory by its slug.",
        "Use this AFTER you saw the slug in the memory menu (injected in the system prompt) and want the body.",
        "Slugs not in the menu may still exist; they will be ranked low — prefer search_memory for unknown terms.",
        "Calling this counts as a read and bumps the entry's recency in future menus.",
    ].join("\n"),
    search: [
        "Search long-term memories by content (BM25 over markdown bodies).",
        "Use this when the user mentions a specific term, identifier, or topic that is NOT visible in the memory menu in the system prompt.",
        "Tokenization splits on punctuation; for literals like URLs or ports, search a single rare token (e.g. \"5433\", not the full URL).",
        "Returns slug + title + snippet; call read_memory(slug) afterwards if you need the full body.",
    ].join("\n"),
};

// ── MemoryLLM CRUD schema（与 prompts/memory/writer/default.md 对齐） ──
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MemoryKindSchema = z.enum([
    MemoryKind.Preference,
    MemoryKind.Fact,
    MemoryKind.Workflow,
    MemoryKind.Project,
    MemoryKind.Decision,
    MemoryKind.Summary,
]);
const MemoryBodyModeSchema = z.enum(['replace', 'append']);

export enum MemoryOpAction {
    Create = 'create',
    Update = 'update',
    Delete = 'delete',
    Noop = 'noop',
}

const CreateOp = z.object({
    action: z.literal(MemoryOpAction.Create),
    slug: z.string().regex(SLUG_PATTERN),
    kind: MemoryKindSchema.optional().default(MemoryKind.Fact),
    title: z.string().min(1).max(100),
    description: z.string().min(1).max(200),
    body: z.string().min(1),
});

const UpdateOp = z.object({
    action: z.literal(MemoryOpAction.Update),
    slug: z.string().regex(SLUG_PATTERN),
    kind: MemoryKindSchema.optional(),
    title: z.string().min(1).max(100).optional(),
    description: z.string().min(1).max(200).optional(),
    body: z.string().min(1).optional(),
    bodyMode: MemoryBodyModeSchema.optional(),
    reason: z.string().min(1),
});

const DeleteOp = z.object({
    action: z.literal(MemoryOpAction.Delete),
    slug: z.string().regex(SLUG_PATTERN),
    reason: z.string().min(1),
});

const NoopOp = z.object({
    action: z.literal(MemoryOpAction.Noop),
    reason: z.string().min(1),
});

export const MemoryOpSchema = z.discriminatedUnion('action', [CreateOp, UpdateOp, DeleteOp, NoopOp]);
export const MemoryWriteOutputSchema = z.object({
    ops: z.array(MemoryOpSchema),
});

export type MemoryWriteOutput = z.infer<typeof MemoryWriteOutputSchema>;
export type MemoryOp = z.infer<typeof MemoryOpSchema>;
type MemoryJobStats = MemoryWriterOpStats & {
    indexed?: number;
    pruned?: number;
};

const MemoryUpdateMergeSchema = z.object({
    title: z.string().min(1).max(100).optional(),
    description: z.string().min(1).max(200).optional(),
    body: z.string().min(1).optional(),
    bodyMode: MemoryBodyModeSchema.optional(),
});
type MemoryUpdateMergeOutput = z.infer<typeof MemoryUpdateMergeSchema>;

/**
 * Memory 系统的运行时 facade。每个 memoryProfile 一个实例（由 sbot 侧 MemoryServicePool 管理）。
 *
 * 三个职责：
 * - 渲染注入用的 menu prompt（替换 {{ memory_menu }}）
 * - 透传 readMemory / search 给 store
 * - 串行抽取：每轮对话结束 push 进 SQLite 队列，内部 isRunning 标志保证同 profile 只一个 LLM 调用在跑
 *
 * 互斥模型（参考 HistoryManager.ExecuteCommand / CheckExecuteCommand）：
 * - 每个 memoryId 一个 MemoryService 实例（pool 维护）
 * - 多 session 同时 extractFromConversation：push 互不阻塞，kick 后 checkJobs 串行 drain
 * - 单标志 isRunning 即可：单线程 JS + 同步 better-sqlite3 + microtask FIFO 保证
 *   "push 在 drain 退出后必然能再次 kick 起一轮"，不需要 pendingWakeup 这种二级标志
 */
export class MemoryService implements IMemoryService {
    private logger?: ILogger;
    private readonly modelService: IModelService;
    private readonly writerPrompt: string;
    private isRunning = false;
    private refCount = 0;
    private disposed = false;
    private deleteOnTeardown = false;
    private memoryName = '未知配置';
    /** 每个 service 实例首次 drain 时先做一次 FS/DB 对账，再消费 pending jobs。 */
    private initReconciled = false;
    constructor(
        @inject(IMemoryStore) private readonly store: IMemoryStore,
        @inject(T_MemoryReadTemplate) private readonly readTemplate: string,
        @inject(T_MemoryWriterPrompt) writerPrompt: string,
        @inject(IModelService) modelService: IModelService,
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
    ) {
        this.logger = loggerService?.getLogger("MemoryService");
        this.modelService = modelService;
        this.writerPrompt = writerPrompt;
    }

    // ── 生命周期：refCount 配对，归零一次性 teardown ──

    /** 由 MemoryServicePool 构造后注入，避免日志从 memoryDir 反推配置名。 */
    setMemoryName(memoryName: string | undefined): void {
        this.memoryName = memoryName?.trim() || '未知配置';
    }

    /** Pool 在 acquire 时调用：refCount++。仅 pool 用，不在 IMemoryService 接口暴露。 */
    incRef(): void {
        this.refCount++;
    }

    /**
     * Pool 在 deleteAfterRelease(id) 时调用：标记本实例 teardown 后物理清理 store 文件。
     * 不立即 dispose —— 已 acquire 的 caller 继续用，drain 也会跑完，等 refCount 归零自然走到 release 里执行 deleteAll。
     */
    markForDeletion(): void {
        this.deleteOnTeardown = true;
    }

    /** Caller 调用（AgentRunner finally）：refCount--，归零关 store 并让 pool 驱逐自己。 */
    release(): void {
        if (--this.refCount !== 0 || this.disposed) return;
        this.disposed = true;
        try {
            this.store.dispose();
        } catch (e: any) {
            this.logMemory('warn', `记忆存储关闭失败: 错误=${formatError(e, true)}`);
        }
        memoryServicePool.evict(this);
        if (this.deleteOnTeardown) {
            // dispose 已关 sqlite handle，rm 安全。fire-and-forget：调用方不需要等物理删除完成。
            this.store.deleteAll().catch(e => {
                this.logMemory('warn', `记忆存储删除失败: 错误=${formatError(e, true)}`);
            });
        }
    }

    // ── 读路径 ──

    async getSystemMessage(): Promise<string | null> {
        const menu = await this.store.listMenu(DEFAULT_READ_MENU_LIMIT);
        const count = menu.length;
        const menuText = count === 0
            ? "_(empty — no memories recorded yet)_"
            : menu.map(m => `- [${m.kind}; evidence=${m.evidenceCount}] \`${m.slug}\` — ${m.description}`).join("\n");
        const block = `${count} ${count === 1 ? "entry" : "entries"} indexed.\n\n${menuText}`;
        return this.readTemplate.replace(/\{\{\s*memory_menu\s*\}\}/g, block);
    }

    async readMemory(slug: string): Promise<MemoryRow | null> {
        const row = await this.store.getBySlug(slug);
        if (!row) return null;
        try {
            await this.store.recordRead(slug, Date.now());
        } catch (e: any) {
            // recordRead 失败不该影响读取本身
            this.logMemory('warn', `记忆读取计数失败: slug=${slug}, 错误=${formatError(e, true)}`);
        }
        return row;
    }

    async search(query: string, limit?: number): Promise<MemorySearchHit[]> {
        return this.store.search(query, limit ?? DEFAULT_SEARCH_LIMIT, DEFAULT_SCORE_FLOOR);
    }

    getToolDescs(): MemoryToolDescs {
        return DEFAULT_TOOL_DESCS;
    }

    async listAll(): Promise<MemoryRow[]> {
        return this.store.list();
    }

    async deleteMemory(slug: string): Promise<string> {
        const archive = await this.store.softDelete(slug, Date.now());
        this.logMemory('info', `记忆管理删除: slug=${slug}, 归档=${archive}`);
        return archive;
    }

    // ── 写路径：入队 + 串行消费 ──

    extractFromConversation(messages: ChatMessage[]): void {
        if (messages.length === 0) return;
        try {
            this.store.pushPendingMessages(messages, Date.now());
        } catch (e: any) {
            this.logMemory('warn', `记忆抽取入队失败: 错误=${formatError(e, true)}`);
            return;
        }
        void this.checkJobs();
    }

    listPending(limit?: number): PendingMemoryJobRow[] {
        return this.store.listPendingJobs(limit ?? 50);
    }

    processPending(): void {
        void this.checkJobs();
    }

    enqueueConsolidate(): number {
        const id = this.store.pushPendingConsolidate(Date.now());
        void this.checkJobs();
        return id;
    }

    enqueueReconcile(): number {
        const id = this.store.pushPendingReconcile(Date.now());
        void this.checkJobs();
        return id;
    }

    retryExtractJob(id: number): boolean {
        const retried = this.store.retryFailedExtractJob(id, Date.now());
        if (retried) void this.checkJobs();
        return retried;
    }

    /**
     * 串行消费 pending job 队列：首次先 reconcile，之后循环 popPendingJob → 处理 → 删行 / 标 failed。
     *
     * 互斥与漏单保证：
     * - 顶部 `if (isRunning) return` 同步短路重入（与下一行 isRunning=true 无 await 缝隙）；
     * - 初始 reconcile 在同一条 drain 内执行，避免与 extract/consolidate 并发写 FS/DB；
     * - 任何 push 都是先同步 SQL INSERT 再 `void checkJobs()`：
     *   若当前 drain 还在跑，循环里下一次 pop 必然命中（同步 SQL，已落库）；
     *   若已退出，新调用直接进入新一轮 drain（finally 已置 isRunning=false）。
     * - 自固定 refCount：drain 自己持一份引用，期间 caller release 不会触发 teardown，
     *   drain 跑完 finally 里再 release —— 调用方（chat / admin）无需关心 release 时机。
     * - 异常自吞：DB 操作在 store 被关后会 throw（理论上 self-pin 后不该出现），
     *   全部 catch；未删除的 pending job 留在 SQLite 文件中，下次启动 processPending()
     *   重新拉起。
     */
    private async checkJobs(): Promise<void> {
        if (this.isRunning) return;
        this.isRunning = true;
        this.refCount++;
        try {
            await this.runInitialReconcile();
            while (true) {
                let next: PendingMemoryJobRow | null;
                try {
                    next = this.store.popPendingJob();
                } catch {
                    break;  // forceDispose 关闭了 store → 优雅退出
                }
                if (!next) break;
                const log = this.jobLog(next);
                try {
                    this.logMemory('info', `${log.start}：${log.subject}`);
                    const stats = await this.runPendingJob(next);
                    this.store.deletePendingJob(next.id);
                    this.logMemory('info', `${log.done}：${log.subject}${this.jobDoneSuffix(stats)}`);
                } catch (e: any) {
                    const errMsg = truncateForLog(formatError(e));
                    try { this.store.markPendingJobFailed(next.id, errMsg, Date.now()); } catch { /* store closed; swallow */ }
                    this.logMemory('warn',`${log.failed}：${log.subject}，尝试=${next.attemptCount + 1}，` +`模型=${this.modelLabel()}，错误=${formatError(e, true)}`);
                }
            }
        } finally {
            this.isRunning = false;
            this.release();  // 配对开头 refCount++；归零自动 teardown
        }
    }

    private async runInitialReconcile(): Promise<void> {
        if (this.initReconciled) return;
        try {
            const stats = await this.store.reconcile();
            if (stats.indexed > 0 || stats.pruned > 0) {
                this.logMemory('info', `记忆初始化对账: 索引=${stats.indexed}, 清理=${stats.pruned}`);
            }
        } catch (e: any) {
            this.logMemory('warn', `记忆初始化对账失败: 错误=${formatError(e, true)}`);
        } finally {
            this.initReconciled = true;
        }
    }

    private async runPendingJob(job: PendingMemoryJobRow): Promise<MemoryJobStats> {
        switch (job.type) {
            case MemoryPendingJobType.Extract:
                return this.extractFromMessages(job);
            case MemoryPendingJobType.Consolidate:
                return this.consolidateMemories();
            case MemoryPendingJobType.Reconcile:
                return this.reconcileMemories();
        }
    }

    private async reconcileMemories(): Promise<MemoryJobStats> {
        const stats = await this.store.reconcile();
        return {
            create: 0,
            update: 0,
            delete: 0,
            noop: 0,
            failed: 0,
            indexed: stats.indexed,
            pruned: stats.pruned,
        };
    }

    // ── MemoryLLM CRUD 抽取（原 MemoryWriterWorker） ──

    /**
     * 单轮抽取：把一组对话消息喂给 MemoryLLM，应用返回的 ops。
     * 模型调用失败会抛出，由 checkJobs 决定是否标记 pending job 为 failed。
     */
    private async extractFromMessages(job: PendingMemoryJobRow): Promise<MemoryWriterOpStats> {
        const messages = job.messages ?? [];
        if (messages.length === 0) {
            return { create: 0, update: 0, delete: 0, noop: 1, failed: 0 };
        }

        const conversation = renderConversation(messages);
        const menu = await this.store.listMenu(DEFAULT_WRITER_MENU_LIMIT);
        const menuLines = menu.length === 0
            ? '_(no existing memories)_'
            : menu.map(m => `- [${m.kind}; evidence=${m.evidenceCount}] ${m.slug} — ${m.description}`).join('\n');
        const input = [
            `# Existing memories (${menu.length} ${menu.length === 1 ? 'entry' : 'entries'})`,
            ``,
            menuLines,
            ``,
            `# Conversation transcript`,
            ``,
            conversation,
            ``,
            `---`,
            ``,
            `Decide what — if anything — to record. Default to a single \`noop\` if`,
            `nothing in this transcript meets the high-signal bar.`,
        ].join('\n');

        const llmMessages: ChatMessage[] = [
            { role: MessageRole.System, content: this.writerPrompt },
            { role: MessageRole.Human, content: input },
        ];

        const result = await this.modelService.invokeStructured<MemoryWriteOutput>(MemoryWriteOutputSchema, llmMessages);
        return await this.applyOps(result.ops, { conversation, mergeUpdateBodies: true });
    }

    private async consolidateMemories(): Promise<MemoryWriterOpStats> {
        const rows = (await this.store.list()).slice(0, 100);
        if (rows.length === 0) {
            return { create: 0, update: 0, delete: 0, noop: 1, failed: 0 };
        }

        // 不截断 body：consolidate 关注 "duplicated / stale / overly verbose"，verbose 检测就需要看完整内容；
        // prompt 预算靠上面的 slice(0, 100) 兜底，单条体积不在这层处理。
        const entries = rows.map(r => [
            `## ${r.slug}`,
            `kind: ${r.kind}`,
            `title: ${r.title}`,
            `description: ${r.description}`,
            `evidence_count: ${r.evidenceCount}`,
            `updated_at: ${new Date(r.updatedAt).toISOString()}`,
            ``,
            r.body,
        ].join('\n')).join('\n\n---\n\n');

        const messages: ChatMessage[] = [
            {
                role: MessageRole.System,
                content: [
                    `You consolidate a long-term memory store.`,
                    `Return structured ops only.`,
                    `Prefer noop unless entries are duplicated, stale, contradictory, or overly verbose.`,
                    `Allowed useful actions: update an existing memory to merge duplicate details; delete an entry only when it is clearly redundant or superseded.`,
                    `Do not create new memories during consolidation.`,
                    `If updating body, write the full final body without the H1 title line.`,
                ].join('\n'),
            },
            {
                role: MessageRole.Human,
                content: [
                    `# Existing memory entries`,
                    ``,
                    entries,
                    ``,
                    `---`,
                    ``,
                    `Consolidate these entries conservatively. Keep durable facts and user preferences. Default to noop.`,
                ].join('\n'),
            },
        ];

        const result = await this.modelService.invokeStructured<MemoryWriteOutput>(MemoryWriteOutputSchema, messages);

        // 安全闸门：单次整理最多 30 ops；其中 delete 不超过 max(10, 30% 总量)。
        // 防止一次坏 LLM 输出（如全删）打爆记忆库。
        const filtered = result.ops.filter(op => op.action !== MemoryOpAction.Create);
        const capped = MemoryService.capConsolidateOps(filtered, rows.length);
        if (capped.length < filtered.length) {
            this.logMemory('warn', `记忆整理操作截断：原始=${filtered.length}, 保留=${capped.length}, 条目=${rows.length}`);
        }
        return this.applyOps(capped, { mergeUpdateBodies: false });
    }

    private static readonly CONSOLIDATE_TOTAL_CAP = 30;

    /**
     * cap 只针对会改 store 的 op（update / delete）。noop 完整保留——它们不破坏数据，
     * 让它们占用 cap 名额会把后面真实的 mutation 截掉（LLM prompt 鼓励 noop，常返回大量
     * "no change" 占位）。
     */
    private static capConsolidateOps(ops: MemoryOp[], corpusSize: number): MemoryOp[] {
        const deleteCap = Math.max(10, Math.floor(corpusSize * 0.3));
        let deleteCount = 0;
        let mutationCount = 0;
        const out: MemoryOp[] = [];
        for (const op of ops) {
            if (op.action === MemoryOpAction.Noop) {
                out.push(op);
                continue;
            }
            if (mutationCount >= MemoryService.CONSOLIDATE_TOTAL_CAP) continue;
            if (op.action === MemoryOpAction.Delete) {
                if (deleteCount >= deleteCap) continue;
                deleteCount++;
            }
            out.push(op);
            mutationCount++;
        }
        return out;
    }

    /**
     * 单 op 失败不破坏整体：每条独立 try/catch。
     * 失败原因（slug 冲突 / 不存在等）记 warn 日志。
     */
    private async applyOps(ops: MemoryOp[], context: { conversation?: string; mergeUpdateBodies?: boolean }): Promise<MemoryWriterOpStats> {
        const out: MemoryWriterOpStats = { create: 0, update: 0, delete: 0, noop: 0, failed: 0 };
        const now = Date.now();
        for (const op of ops) {
            try {
                switch (op.action) {
                    case MemoryOpAction.Create:
                        await this.store.create({
                            slug: op.slug,
                            kind: op.kind as MemoryKind,
                            title: op.title,
                            description: op.description,
                            body: op.body,
                        }, now);
                        out.create++;
                        this.logMemory('info', `添加记忆：${op.slug} - ${truncateForLog(op.title)}`);
                        break;
                    case MemoryOpAction.Update:
                        const update = context.mergeUpdateBodies && op.body
                            ? await this.mergeUpdateBody(op, context.conversation)
                            : op;
                        await this.store.update({
                            slug: update.slug,
                            kind: update.kind as MemoryKind | undefined,
                            title: update.title,
                            description: update.description,
                            body: update.body,
                            bodyMode: update.bodyMode as MemoryBodyMode | undefined,
                            evidenceDelta: 1,
                        }, now);
                        out.update++;
                        this.logMemory('info', `修改记忆：${op.slug} - ${truncateForLog(op.reason)}`);
                        break;
                    case MemoryOpAction.Delete:
                        await this.store.softDelete(op.slug, now);
                        out.delete++;
                        this.logMemory('info', `删除记忆：${op.slug} - ${truncateForLog(op.reason)}`);
                        break;
                    case MemoryOpAction.Noop:
                        out.noop++;
                        break;
                }
            } catch (e: any) {
                out.failed++;
                this.logMemory(
                    'warn',
                    `记忆操作失败：${MemoryService.opActionName(op.action)} ` +
                    `${('slug' in op) ? op.slug : ''}，错误=${formatError(e, true)}`
                );
            }
        }
        return out;
    }

    private async mergeUpdateBody(
        op: Extract<MemoryOp, { action: MemoryOpAction.Update }>,
        conversation: string | undefined,
    ): Promise<Extract<MemoryOp, { action: MemoryOpAction.Update }>> {
        const existing = await this.store.getBySlug(op.slug);
        if (!existing) return op;

        const messages: ChatMessage[] = [
            {
                role: MessageRole.System,
                content: [
                    `You safely merge an update into an existing long-term memory.`,
                    `The existing body is authoritative unless the new transcript clearly supersedes it.`,
                    `Return only fields that should change.`,
                    `If body changes, return the full final body without the H1 title line.`,
                    `Use bodyMode="replace" for a full revised body, or bodyMode="append" only for a small additive note.`,
                ].join('\n'),
            },
            {
                role: MessageRole.Human,
                content: [
                    `# Existing memory`,
                    `slug: ${existing.slug}`,
                    `kind: ${existing.kind}`,
                    `title: ${existing.title}`,
                    `description: ${existing.description}`,
                    ``,
                    existing.body,
                    ``,
                    `# Proposed update`,
                    JSON.stringify({
                        kind: op.kind,
                        title: op.title,
                        description: op.description,
                        body: op.body,
                        bodyMode: op.bodyMode,
                        reason: op.reason,
                    }, null, 2),
                    ``,
                    `# Source conversation window`,
                    conversation ?? '',
                ].join('\n'),
            },
        ];

        try {
            const merged = await this.modelService.invokeStructured<MemoryUpdateMergeOutput>(MemoryUpdateMergeSchema, messages);
            return {
                ...op,
                title: merged.title ?? op.title,
                description: merged.description ?? op.description,
                body: merged.body ?? op.body,
                bodyMode: merged.bodyMode ?? op.bodyMode,
            };
        } catch (e: any) {
            this.logMemory('warn', `合并修改记忆失败：${op.slug}，错误=${formatError(e, true)}`);
            // 保护旧 body：merge 失败时只应用 title/description/kind，不直接替换正文。
            return {
                ...op,
                body: undefined,
                bodyMode: undefined,
            };
        }
    }

    private modelLabel(): string {
        const cfg = this.modelService.config as any;
        const name = cfg.name || cfg.model || '?';
        const detail = [
            cfg.provider,
            cfg.model && cfg.model !== name ? cfg.model : '',
        ].filter(Boolean).join('/');
        return detail ? `${name}(${detail})` : name;
    }

    private memoryLabel(): string {
        return truncateForLog(this.memoryName, 80);
    }

    private logMemory(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
        const line = `[记忆:${this.memoryLabel()}] ${message}`;
        switch (level) {
            case 'debug':
                this.logger?.debug(line);
                break;
            case 'info':
                this.logger?.info(line);
                break;
            case 'warn':
                this.logger?.warn(line);
                break;
            case 'error':
                this.logger?.error(line);
                break;
        }
    }

    private jobDoneSuffix(stats: MemoryJobStats): string {
        const parts: string[] = [];
        if (stats.indexed != null) parts.push(`索引=${stats.indexed}`);
        if (stats.pruned != null) parts.push(`清理=${stats.pruned}`);
        if (stats.failed > 0) parts.push(`失败=${stats.failed}`);
        return parts.length > 0 ? `，${parts.join('，')}` : '';
    }

    private jobLog(job: PendingMemoryJobRow): { start: string; done: string; failed: string; subject: string } {
        switch (job.type) {
            case MemoryPendingJobType.Extract:
                return {
                    start: '开始解析记忆',
                    done: '解析记忆完成',
                    failed: '解析记忆失败',
                    subject: MemoryService.messagePreview(job.messages ?? []),
                };
            case MemoryPendingJobType.Consolidate:
                return {
                    start: '开始整理记忆',
                    done: '整理记忆完成',
                    failed: '整理记忆失败',
                    subject: '当前记忆库',
                };
            case MemoryPendingJobType.Reconcile:
                return {
                    start: '开始同步记忆索引',
                    done: '同步记忆索引完成',
                    failed: '同步记忆索引失败',
                    subject: '当前记忆库',
                };
            default:
                return {
                    start: '开始处理记忆',
                    done: '处理记忆完成',
                    failed: '处理记忆失败',
                    subject: String(job.type),
                };
        }
    }

    private static opActionName(action: MemoryOpAction): string {
        switch (action) {
            case MemoryOpAction.Create:
                return '新建';
            case MemoryOpAction.Update:
                return '更新';
            case MemoryOpAction.Delete:
                return '删除';
            case MemoryOpAction.Noop:
                return '无变更';
            default:
                return String(action);
        }
    }

    private static messagePreview(messages: ChatMessage[]): string {
        const message = [...messages].reverse().find(m => m.role === MessageRole.Human) ?? messages[messages.length - 1];
        if (!message) return '空消息';
        const text = MemoryService.contentToText(message.content).replace(/\s+/g, ' ').trim();
        if (!text) return '空消息';
        return truncateForLog(text);
    }

    private static contentToText(content: ChatMessage['content']): string {
        const text = contentToString(content);
        if (text) return text;
        try {
            return JSON.stringify(content);
        } catch {
            return String(content);
        }
    }
}

