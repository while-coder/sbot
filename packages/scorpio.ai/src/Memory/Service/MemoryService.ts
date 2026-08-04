import { z } from "zod";
import { inject } from "scorpio.di";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import {
    T_MemoryReadTemplate,
    T_MemoryWriterPrompt,
} from "../../Core/tokens";
import { formatError, runtimeActivity } from "../../Core";
import { ILogger, ILoggerService } from "../../Logger";
import { IModelService } from "../../Model";
import {
    type MemoryToolDescs,
    type MemoryWriterOpStats,
} from "./IMemoryService";
import {
    IMemoryStore,
    MemoryKind,
    MemoryScope,
    type MemoryRow,
    type MemorySearchHit,
    type MemoryBodyMode,
    MemoryPendingJobType,
    type PendingMemoryJobRow,
    type MemoryWorkspaceScope,
    type MemoryTarget,
} from "../Storage/IMemoryStore";
import { type ChatMessage, MessageRole } from "../../Saver";
import { contentToString, truncateForLog } from "../../Utils/contentUtils";
import { renderConversation } from "../../Utils/conversationUtils";
import { memoryServicePool } from "./MemoryServicePool";
import { GlobalMemoryService } from "./GlobalMemoryService";
import {
    ScopedMemoryService,
    WORKSPACE_MEMORY_DIR,
    WORKSPACE_MEMORY_META_FILE,
} from "./ScopedMemoryService";

// 读路径（每轮注入 system prompt）—— 高频常驻成本，截到 evidence/recency 排序里的头部就够，
// 模型未命中时还有 search_memory 工具兜底。
const DEFAULT_READ_MENU_LIMIT = 50;
// 写路径（writer LLM 单次抽取）—— 单次成本，需要更广的覆盖来判断 create/update 去重。
const DEFAULT_WRITER_MENU_LIMIT = 200;
const DEFAULT_SEARCH_LIMIT = 10;
const DEFAULT_SCORE_FLOOR = 0.15;

const DEFAULT_TOOL_DESCS: MemoryToolDescs = {
    read: [
        "Read the full content of a long-term memory by its slug and required scope.",
        "Use this AFTER you saw the slug in the memory menu (injected in the system prompt) and want the body.",
        "Slugs not in the menu may still exist; they will be ranked low — prefer search_memory for unknown terms.",
        "Calling this counts as a read and bumps the entry's recency in future menus.",
        "Always pass the scope shown in the memory menu or search result.",
    ].join("\n"),
    search: [
        "Search long-term memories by content (BM25 over markdown bodies).",
        "Use this when the user mentions a specific term, identifier, or topic that is NOT visible in the memory menu in the system prompt.",
        "Tokenization splits on punctuation; for literals like URLs or ports, search a single rare token (e.g. \"5433\", not the full URL).",
        "Results use the same one-line shape as the memory menu (kind / evidence / slug / title) plus the matched snippet, so a hit already in the menu is recognisable as the same entry.",
        "Call read_memory(slug, scope) afterwards if you need the full body.",
    ].join("\n"),
};

// ── MemoryLLM CRUD schema（与 prompts/memory/writer/default.md 对齐） ──
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
/**
 * title 是条目的唯一标签：既是文件的 H1，也是注入 system prompt 的 menu 行。
 * 比"标题"该有的长度宽一些——reader 在 menu 里看不到 body，得靠这一行判断值不值得打开。
 */
const TITLE_MAX = 150;
const MemoryKindSchema = z.enum([
    MemoryKind.Preference,
    MemoryKind.Fact,
    MemoryKind.Workflow,
    MemoryKind.Project,
    MemoryKind.Decision,
    MemoryKind.Summary,
]);
const MemoryBodyModeSchema = z.enum(['replace', 'append']);
const MemoryScopeSchema = z.enum([MemoryScope.Global, MemoryScope.Workspace]);

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
    title: z.string().min(1).max(TITLE_MAX),
    body: z.string().min(1),
    scope: MemoryScopeSchema,
});

const UpdateOp = z.object({
    action: z.literal(MemoryOpAction.Update),
    slug: z.string().regex(SLUG_PATTERN),
    kind: MemoryKindSchema.optional(),
    title: z.string().min(1).max(TITLE_MAX).optional(),
    body: z.string().min(1).optional(),
    bodyMode: MemoryBodyModeSchema.optional(),
    reason: z.string().min(1),
    scope: MemoryScopeSchema,
});

const DeleteOp = z.object({
    action: z.literal(MemoryOpAction.Delete),
    slug: z.string().regex(SLUG_PATTERN),
    reason: z.string().min(1),
    scope: MemoryScopeSchema,
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
    title: z.string().min(1).max(TITLE_MAX).optional(),
    body: z.string().min(1).optional(),
    bodyMode: MemoryBodyModeSchema.optional(),
});
type MemoryUpdateMergeOutput = z.infer<typeof MemoryUpdateMergeSchema>;

/** applyOps 的执行上下文：区分「真实对话抽取」和「后台整理」两条调用路径。 */
type ApplyOpsContext = {
    /** 原始对话文本，mergeUpdateBody 需要它判断新信息是否真的取代旧 body */
    conversation?: string;
    /** 是否为带 body 的 update 额外走一次合并 LLM（抽取路径 true，整理路径 false） */
    mergeUpdateBodies?: boolean;
    /**
     * 每次 update 给 evidence_count 加多少。
     *
     * evidence 的含义是「有多少次**对话**提到/印证过这条」，所以只有抽取路径能 +1；
     * consolidate 是无新对话的自我整理，必须传 0——否则一轮整理就能把全库 evidence
     * 抬高一档，reader 那边「高 evidence = 反复确认过」的判断随之失真。
     */
    evidenceDelta: number;
    /** 当前任务的显式目标；workspace 目标必然携带规范化目录。 */
    target: MemoryTarget;
    /** null 表示 Writer 可按 op.scope 路由；整理任务传固定 scope。 */
    fixedScope: MemoryScope | null;
};

const GLOBAL_MEMORY_TARGET: MemoryTarget = { scope: MemoryScope.Global };

function workspaceMemoryTarget(workspace: MemoryWorkspaceScope): MemoryTarget {
    return { scope: MemoryScope.Workspace, workspace };
}

const MEMORY_SCOPE_WRITER_INSTRUCTION = [
    `Every create/update/delete operation must include a scope: "global" or "workspace".`,
    `Use global only for durable user preferences, machine-wide facts, and workflows that apply across projects.`,
    `Use workspace for repository paths, project conventions, module maps, build steps, architecture decisions, and project-specific failures.`,
    `When a workspace is available and the correct scope is uncertain, choose workspace to avoid leaking project context into other workspaces.`,
    `When no workspace is available, use global.`,
    `For update/delete, preserve the scope shown beside the existing entry.`,
].join('\n');

/**
 * Memory 系统的运行时协调器。每个 memoryProfile 一个实例（由 sbot 侧 MemoryServicePool 管理），
 * 内部同时管理全局 Store 与按 workPath 惰性创建的工作区 Store。
 *
 * 三个职责：
 * - 渲染注入用的 menu prompt（替换 {{ memory_menu }}）
 * - 合并全局 + 当前工作区的 menu/read/search，并保持其他工作区不可见
 * - 串行抽取：每轮对话结束 push 进 SQLite 队列，内部 isRunning 标志保证同 profile 只一个 LLM 调用在跑
 *
 * 互斥模型（参考 HistoryManager.ExecuteCommand / CheckExecuteCommand）：
 * - 每个 memoryId 一个 MemoryService 实例（pool 维护）
 * - 多 session 同时 extractFromConversation：push 互不阻塞，kick 后 checkJobs 串行 drain
 * - 单标志 isRunning 即可：单线程 JS + 同步 better-sqlite3 + microtask FIFO 保证
 *   "push 在 drain 退出后必然能再次 kick 起一轮"，不需要 pendingWakeup 这种二级标志
 */
export class MemoryService {
    private logger?: ILogger;
    private readonly modelService: IModelService;
    private readonly writerPrompt: string;
    private isRunning = false;
    private refCount = 0;
    private disposed = false;
    private deleteOnTeardown = false;
    private memoryName = '未知配置';
    private readonly workspaceServices = new Map<string, ScopedMemoryService>();
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

    /**
     * 获取绑定规范化 workPath 的工作区服务。同一 owner + workPath 复用同一实例，
     * owner 仍按 memoryId 全局唯一，工作区 Store 与 reconcile 状态互不串扰。
     */
    bind(workPath: string): ScopedMemoryService {
        const normalized = workPath.trim();
        if (!normalized) throw new Error('MemoryService.bind requires a non-empty workPath');
        return this.getWorkspaceService(this.resolveWorkspace(normalized));
    }

    /** 为管理路径创建固定的全局视图。 */
    bindGlobal(): GlobalMemoryService {
        return new GlobalMemoryService(this);
    }

    /** Admin 使用：只读 scope.json，不打开工作区 SQLite。 */
    listWorkspaceScopes(): MemoryWorkspaceScope[] {
        const workspacesDir = path.join(this.store.rootDir, WORKSPACE_MEMORY_DIR);
        if (!existsSync(workspacesDir)) return [];
        const out: MemoryWorkspaceScope[] = [];
        for (const key of readdirSync(workspacesDir)) {
            const metaPath = path.join(workspacesDir, key, WORKSPACE_MEMORY_META_FILE);
            try {
                const parsed = JSON.parse(readFileSync(metaPath, 'utf8'));
                if (parsed && typeof parsed.path === 'string') out.push({ key, path: parsed.path });
            } catch { /* 非工作区目录或旧的不完整目录，忽略 */ }
        }
        return out.sort((a, b) => a.path.localeCompare(b.path));
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
        for (const workspaceService of this.workspaceServices.values()) {
            try { workspaceService.dispose(); }
            catch (e: any) {
                this.logMemory('warn', `工作区记忆存储关闭失败: path=${workspaceService.workspace.path}, 错误=${formatError(e, true)}`);
            }
        }
        this.workspaceServices.clear();
        try { this.store.dispose(); }
        catch (e: any) {
            this.logMemory('warn', `全局记忆存储关闭失败: 错误=${formatError(e, true)}`);
        }
        memoryServicePool.evict(this);
        if (this.deleteOnTeardown) {
            // dispose 已关 sqlite handle，rm 安全。fire-and-forget：调用方不需要等物理删除完成。
            this.store.deleteAll().catch(e => {
                this.logMemory('warn', `记忆存储删除失败: 错误=${formatError(e, true)}`);
            });
        }
    }

    private resolveWorkspace(workPath: string): MemoryWorkspaceScope {
        const resolved = path.resolve(workPath);
        let canonical = resolved;
        try { canonical = realpathSync.native(resolved); } catch { /* AgentRunner 会创建目录；不可解析时仍用绝对路径 */ }
        canonical = path.normalize(canonical).replace(/[\\/]+$/, '') || path.parse(canonical).root;
        const identity = process.platform === 'win32' ? canonical.toLocaleLowerCase('en-US') : canonical;
        return {
            key: createHash('sha256').update(identity).digest('hex').slice(0, 24),
            path: canonical,
        };
    }

    private getWorkspaceService(workspace: MemoryWorkspaceScope): ScopedMemoryService {
        const cached = this.workspaceServices.get(workspace.key);
        if (cached) return cached;
        const service = new ScopedMemoryService(this, workspace, this.store.rootDir);
        this.workspaceServices.set(workspace.key, service);
        return service;
    }

    private async ensureWorkspaceReconciled(workspace: MemoryWorkspaceScope): Promise<IMemoryStore> {
        const service = this.getWorkspaceService(workspace);
        const firstReconcile = !service.hasReconciled;
        const stats = await service.reconcile(false);
        if (firstReconcile && (stats.indexed > 0 || stats.pruned > 0)) {
            this.logMemory('info', `工作区记忆初始化对账: path=${workspace.path}，索引=${stats.indexed}，清理=${stats.pruned}`);
        }
        return service.store;
    }

    private async storeForTarget(target: MemoryTarget): Promise<IMemoryStore> {
        return target.scope === MemoryScope.Workspace
            ? this.ensureWorkspaceReconciled(target.workspace)
            : this.store;
    }

    private entryTarget(scope: MemoryScope, viewTarget: MemoryTarget): MemoryTarget {
        if (scope === MemoryScope.Global) return GLOBAL_MEMORY_TARGET;
        if (scope === MemoryScope.Workspace) {
            if (viewTarget.scope === MemoryScope.Workspace) return viewTarget;
            throw new Error('Global memory view cannot access workspace scope without a workPath');
        }
        throw new Error(`Unsupported memory scope: ${String(scope)}`);
    }

    private async listScopedMenus(limit: number, target: MemoryTarget): Promise<{
        globalMenu: Awaited<ReturnType<IMemoryStore['listMenu']>>;
        workspaceMenu: Awaited<ReturnType<IMemoryStore['listMenu']>>;
    }> {
        if (target.scope === MemoryScope.Global) {
            return { globalMenu: await this.store.listMenu(limit), workspaceMenu: [] };
        }
        const totalLimit = Math.max(0, Math.floor(limit));
        if (totalLimit === 0) return { globalMenu: [], workspaceMenu: [] };

        const workspaceStore = await this.storeForTarget(target);
        // 工作区与全局记忆分别保底，避免工作区条目先吃满总额度后让 global 完全消失。
        // 一侧不足时把空余额回填给另一侧，最终总量仍不超过调用方给出的 limit。
        const globalQuota = totalLimit > 1
            ? Math.max(1, Math.floor(totalLimit * 0.4))
            : 0;
        const workspaceQuota = totalLimit - globalQuota;
        let [workspaceMenu, globalMenu] = await Promise.all([
            workspaceStore.listMenu(workspaceQuota),
            this.store.listMenu(globalQuota),
        ]);

        if (workspaceMenu.length < workspaceQuota) {
            globalMenu = await this.store.listMenu(totalLimit - workspaceMenu.length);
        } else if (globalMenu.length < globalQuota) {
            workspaceMenu = await workspaceStore.listMenu(totalLimit - globalMenu.length);
        }
        return { globalMenu, workspaceMenu };
    }

    // ── 读路径 ──

    async getSystemMessage(target: MemoryTarget): Promise<string | null> {
        const menus = await this.listScopedMenus(DEFAULT_READ_MENU_LIMIT, target);
        const globalMenu = menus.globalMenu
            .map(m => ({ ...m, scope: MemoryScope.Global }));
        const workspaceMenu = menus.workspaceMenu
            .map(m => ({ ...m, scope: MemoryScope.Workspace }));
        const menu = [...workspaceMenu, ...globalMenu];
        const count = menu.length;
        const menuText = count === 0
            ? "_(empty — no memories recorded yet)_"
            : menu.map(m => `- [${m.scope}; ${m.kind}; evidence=${m.evidenceCount}] \`${m.slug}\` — ${m.title}`).join("\n");
        const block = `${count} ${count === 1 ? "entry" : "entries"} indexed.\n\n${menuText}`;
        return this.readTemplate.replace(/\{\{\s*memory_menu\s*\}\}/g, block);
    }

    async readMemory(slug: string, scope: MemoryScope, viewTarget: MemoryTarget): Promise<MemoryRow | null> {
        const target = this.entryTarget(scope, viewTarget);
        const store = await this.storeForTarget(target);
        const row = await store.getBySlug(slug);
        if (!row) return null;
        try {
            await store.recordRead(slug, Date.now());
        } catch (e: any) {
            // recordRead 失败不该影响读取本身
            this.logMemory('warn', `记忆读取计数失败: slug=${slug}, 错误=${formatError(e, true)}`);
        }
        return { ...row, scope: target.scope };
    }

    async search(query: string, limit: number | undefined, target: MemoryTarget): Promise<MemorySearchHit[]> {
        const cap = limit ?? DEFAULT_SEARCH_LIMIT;
        const globalHits = (await this.store.search(query, cap, DEFAULT_SCORE_FLOOR))
            .map(hit => ({ ...hit, scope: MemoryScope.Global }));
        const workspaceStore = target.scope === MemoryScope.Workspace
            ? await this.storeForTarget(target)
            : null;
        const workspaceHits = workspaceStore
            ? (await workspaceStore.search(query, cap, DEFAULT_SCORE_FLOOR))
                .map(hit => ({ ...hit, scope: MemoryScope.Workspace }))
            : [];
        const scopeRank = (scope: MemoryScope): number => scope === MemoryScope.Workspace ? 0 : 1;
        return [...workspaceHits, ...globalHits]
            .sort((a, b) => b.score - a.score
                || scopeRank(a.scope) - scopeRank(b.scope)
                || a.slug.localeCompare(b.slug))
            .slice(0, cap);
    }

    getToolDescs(): MemoryToolDescs {
        return DEFAULT_TOOL_DESCS;
    }

    async listAll(target: MemoryTarget): Promise<MemoryRow[]> {
        const globalRows = (await this.store.list()).map(row => ({ ...row, scope: MemoryScope.Global }));
        if (target.scope === MemoryScope.Global) return globalRows;
        const workspaceStore = await this.storeForTarget(target);
        const workspaceRows = (await workspaceStore.list())
            .map(row => ({ ...row, scope: MemoryScope.Workspace }));
        return [...workspaceRows, ...globalRows];
    }

    async deleteMemory(slug: string, scope: MemoryScope, viewTarget: MemoryTarget): Promise<string> {
        const target = this.entryTarget(scope, viewTarget);
        const targetStore = await this.storeForTarget(target);
        const archive = await targetStore.softDelete(slug, Date.now());
        this.logMemory('info', `记忆管理删除: scope=${target.scope}, slug=${slug}, 归档=${archive}`);
        return archive;
    }

    // ── 写路径：入队 + 串行消费 ──

    extractFromConversation(messages: ChatMessage[], target: MemoryTarget): void {
        if (messages.length === 0) return;
        try {
            this.store.pushPendingMessages(messages, Date.now(), target);
        } catch (e: any) {
            this.logMemory('warn', `记忆抽取入队失败: 错误=${formatError(e, true)}`);
            return;
        }
        void this.checkJobs();
    }

    listPending(limit: number | undefined, target: MemoryTarget): PendingMemoryJobRow[] {
        return this.store.listPendingJobs(limit ?? 50, target);
    }

    deleteFailedJob(id: number, target: MemoryTarget): boolean {
        return this.store.deleteFailedJob(id, target);
    }

    processPending(): void {
        void this.checkJobs();
    }

    enqueueConsolidate(target: MemoryTarget): number {
        const id = this.store.pushPendingConsolidate(Date.now(), target);
        void this.checkJobs();
        return id;
    }

    enqueueReconcile(target: MemoryTarget): number {
        const id = this.store.pushPendingReconcile(Date.now(), target);
        void this.checkJobs();
        return id;
    }

    retryFailedJob(id: number, target: MemoryTarget): boolean {
        const retried = this.store.retryFailedJob(id, Date.now(), target);
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
        const releaseActivity = runtimeActivity.retain();
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
            releaseActivity();
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
        const target = this.targetForJob(job);
        switch (job.type) {
            case MemoryPendingJobType.Extract:
                return this.extractFromMessages(job, target);
            case MemoryPendingJobType.Consolidate:
                return this.consolidateMemories(target);
            case MemoryPendingJobType.Reconcile:
                return this.reconcileMemories(target);
        }
    }

    private targetForJob(job: PendingMemoryJobRow): MemoryTarget {
        if (job.scope === MemoryScope.Workspace) {
            if (!job.workspace) throw new Error(`Workspace memory job #${job.id} is missing workPath context`);
            return workspaceMemoryTarget(job.workspace);
        }
        return GLOBAL_MEMORY_TARGET;
    }

    private async reconcileMemories(target: MemoryTarget): Promise<MemoryJobStats> {
        const stats = target.scope === MemoryScope.Workspace
            ? await this.getWorkspaceService(target.workspace).reconcile(true)
            : await this.store.reconcile();
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
    private async extractFromMessages(job: PendingMemoryJobRow, target: MemoryTarget): Promise<MemoryWriterOpStats> {
        const messages = job.messages ?? [];
        if (messages.length === 0) {
            return { create: 0, update: 0, delete: 0, noop: 1, failed: 0 };
        }

        const conversation = renderConversation(messages);
        const { globalMenu, workspaceMenu } = await this.listScopedMenus(DEFAULT_WRITER_MENU_LIMIT, target);
        const globalMenuLines = globalMenu.length === 0
            ? '_(no existing memories)_'
            : globalMenu.map(m => `- [global; ${m.kind}; evidence=${m.evidenceCount}] ${m.slug} — ${m.title}`).join('\n');
        const workspaceMenuLines = workspaceMenu.length === 0
            ? '_(no existing workspace memories)_'
            : workspaceMenu.map(m => `- [workspace; ${m.kind}; evidence=${m.evidenceCount}] ${m.slug} — ${m.title}`).join('\n');
        const input = [
            `# Existing global memories (${globalMenu.length} ${globalMenu.length === 1 ? 'entry' : 'entries'})`,
            ``,
            globalMenuLines,
            ...(target.scope === MemoryScope.Workspace ? [
                ``,
                `# Current workspace`,
                ``,
                target.workspace.path,
                ``,
                `# Existing workspace memories (${workspaceMenu.length} ${workspaceMenu.length === 1 ? 'entry' : 'entries'})`,
                ``,
                workspaceMenuLines,
            ] : [
                ``,
                `# Current workspace`,
                ``,
                `_(none — workspace scope is unavailable for this conversation)_`,
            ]),
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
            { role: MessageRole.System, content: `${this.writerPrompt}\n\n# Memory scope routing\n\n${MEMORY_SCOPE_WRITER_INSTRUCTION}` },
            { role: MessageRole.Human, content: input },
        ];

        const result = await this.modelService.invokeStructured<MemoryWriteOutput>(MemoryWriteOutputSchema, llmMessages);
        // 抽取路径：本轮对话确实提到了被 update 的条目 → evidence +1
        return await this.applyOps(result.ops, {
            conversation,
            mergeUpdateBodies: true,
            evidenceDelta: 1,
            target,
            fixedScope: null,
        });
    }

    private async consolidateMemories(target: MemoryTarget): Promise<MemoryWriterOpStats> {
        const targetStore = await this.storeForTarget(target);
        const rows = (await targetStore.list()).slice(0, 100);
        if (rows.length === 0) {
            return { create: 0, update: 0, delete: 0, noop: 1, failed: 0 };
        }

        // 不截断 body：consolidate 关注 "duplicated / stale / overly verbose"，verbose 检测就需要看完整内容；
        // prompt 预算靠上面的 slice(0, 100) 兜底，单条体积不在这层处理。
        const entries = rows.map(r => [
            `## ${r.slug}`,
            `kind: ${r.kind}`,
            `title: ${r.title}`,
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
                    `Every update/delete operation must use scope="${target.scope}".`,
                    `If updating body, write the full final body without the H1 title line.`,
                    `Keep the leading **When:** / **Do:** / **Why:** lines at the very top for actionable entries; a body whose trigger condition is buried at the bottom should be reordered to that shape.`,
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
        // 整理路径：没有新对话作证，只是重写措辞/合并重复 → evidence 不动
        return this.applyOps(capped, {
            mergeUpdateBodies: false,
            evidenceDelta: 0,
            target,
            fixedScope: target.scope,
        });
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
     * 失败原因（slug 不存在等）记 warn 日志。
     */
    private async applyOps(ops: MemoryOp[], context: ApplyOpsContext): Promise<MemoryWriterOpStats> {
        const out: MemoryWriterOpStats = { create: 0, update: 0, delete: 0, noop: 0, failed: 0 };
        const now = Date.now();
        // 同一批里对同一个 slug 下多条 op 一定是 writer 的失误（prompt 里已明确禁止）。
        // 不改变执行语义（顺序执行、后写覆盖前写），只记 warn——静默丢弃某一条更难排查。
        const touched = new Set<string>();
        for (const op of ops) {
            try {
                const target = op.action === MemoryOpAction.Noop
                    ? undefined
                    : await this.resolveOpTarget(op, context);
                if ('slug' in op) {
                    const touchKey = `${target!.scope}:${op.slug}`;
                    if (touched.has(touchKey)) {
                        this.logMemory('warn', `同一批出现重复记忆，按顺序覆盖执行：${touchKey}`);
                    }
                    touched.add(touchKey);
                }
                switch (op.action) {
                    case MemoryOpAction.Create: {
                        // writer 是盲写：它只看到 menu 里的 title，看不到任何 body，
                        // 所以 slug 撞车是可预期结果而不是异常。裸 INSERT 会抛 UNIQUE
                        // 被下面的 catch 吞成 failed，这条记忆就静默丢了——降级成 update，
                        // 走和普通 update 完全相同的安全合并路径，信息至少落进已有条目。
                        const existing = await target!.store.getBySlug(op.slug);
                        if (existing) {
                            this.logMemory('info', `记忆已存在，create 降级为 update：scope=${target!.scope}, slug=${op.slug}`);
                            // 刻意不传 title / kind：那两个值是 writer 为「一条全新条目」编的，
                            // 直接写进去就是盲目覆盖已有条目的标签。省略后 store.update 保留原值，
                            // 而候选标题通过 reason 进入 merge LLM 的输入——它看得到，
                            // 觉得该换标题时自己返回 title 即可。
                            // 这样 merge 失败（catch 分支清空 body）也只是什么都没改，
                            // 不会留下「标签是新事实、正文还是旧的」这种错配。
                            await this.applyUpdate({
                                action: MemoryOpAction.Update,
                                slug: op.slug,
                                body: op.body,
                                scope: op.scope,
                                reason: `create fell back to update: slug already exists. `
                                    + `The new information was drafted as a separate entry `
                                    + `titled "${op.title}" (kind: ${op.kind}).`,
                            }, context, now, target!.store);
                            out.update++;
                            break;
                        }
                        await target!.store.create({
                            slug: op.slug,
                            kind: op.kind as MemoryKind,
                            title: op.title,
                            body: op.body,
                        }, now);
                        out.create++;
                        this.logMemory('info', `添加记忆：scope=${target!.scope}, ${op.slug} - ${truncateForLog(op.title)}`);
                        break;
                    }
                    case MemoryOpAction.Update:
                        await this.applyUpdate(op, context, now, target!.store);
                        out.update++;
                        this.logMemory('info', `修改记忆：scope=${target!.scope}, ${op.slug} - ${truncateForLog(op.reason)}`);
                        break;
                    case MemoryOpAction.Delete:
                        await target!.store.softDelete(op.slug, now);
                        out.delete++;
                        this.logMemory('info', `删除记忆：scope=${target!.scope}, ${op.slug} - ${truncateForLog(op.reason)}`);
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

    private async resolveOpTarget(
        op: Exclude<MemoryOp, { action: MemoryOpAction.Noop }>,
        context: ApplyOpsContext,
    ): Promise<{ store: IMemoryStore; scope: MemoryScope }> {
        const requested = context.fixedScope ?? op.scope;
        const target = this.entryTarget(requested, context.target);
        return { store: await this.storeForTarget(target), scope: target.scope };
    }

    /** update 落库：抽出来给 `case Update` 和 create 撞 slug 的降级路径共用。 */
    private async applyUpdate(
        op: Extract<MemoryOp, { action: MemoryOpAction.Update }>,
        context: ApplyOpsContext,
        now: number,
        store: IMemoryStore,
    ): Promise<void> {
        const merged = context.mergeUpdateBodies && op.body
            ? await this.mergeUpdateBody(op, context.conversation, store)
            : op;
        await store.update({
            slug: merged.slug,
            kind: merged.kind as MemoryKind | undefined,
            title: merged.title,
            body: merged.body,
            bodyMode: merged.bodyMode as MemoryBodyMode | undefined,
            evidenceDelta: context.evidenceDelta,
        }, now);
    }

    private async mergeUpdateBody(
        op: Extract<MemoryOp, { action: MemoryOpAction.Update }>,
        conversation: string | undefined,
        store: IMemoryStore,
    ): Promise<Extract<MemoryOp, { action: MemoryOpAction.Update }>> {
        const existing = await store.getBySlug(op.slug);
        if (!existing) return op;

        const messages: ChatMessage[] = [
            {
                role: MessageRole.System,
                content: [
                    `You safely merge an update into an existing long-term memory.`,
                    `The existing body is authoritative unless the new transcript clearly supersedes it.`,
                    `Return only fields that should change.`,
                    `If body changes, return the full final body without the H1 title line.`,
                    `Keep the leading **When:** / **Do:** / **Why:** lines at the very top when the existing body has them — revise them in place rather than adding a contradicting note below.`,
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
                    ``,
                    existing.body,
                    ``,
                    `# Proposed update`,
                    JSON.stringify({
                        kind: op.kind,
                        title: op.title,
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
                body: merged.body ?? op.body,
                bodyMode: merged.bodyMode ?? op.bodyMode,
            };
        } catch (e: any) {
            this.logMemory('warn', `合并修改记忆失败：${op.slug}，错误=${formatError(e, true)}`);
            // 保护旧 body：merge 失败时只应用 title/kind，不直接替换正文。
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

