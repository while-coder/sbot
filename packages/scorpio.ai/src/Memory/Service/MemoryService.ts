import { z } from "zod";
import { inject } from "scorpio.di";
import {
    T_MemoryReadTemplate,
    T_MemoryWriterPrompt,
    T_MemoryMenuMaxEntries,
    T_MemoryOnRelease,
} from "../../Core/tokens";
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
    type MemoryMenuEntry,
    type MemorySearchHit,
    type MemoryBodyMode,
    type PendingMessageRow,
} from "../Storage/IMemoryStore";
import { type ChatMessage, MessageRole } from "../../Saver";
import { contentToString } from "../../Utils/contentUtils";

const DEFAULT_MENU_LIMIT = 200;
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
 * - 多 session 同时 extractFromConversation：push 互不阻塞，kick 后 checkMessages 串行 drain
 * - 单标志 isRunning 即可：单线程 JS + 同步 better-sqlite3 + microtask FIFO 保证
 *   "push 在 drain 退出后必然能再次 kick 起一轮"，不需要 pendingWakeup 这种二级标志
 */
export class MemoryService implements IMemoryService {
    private logger?: ILogger;
    private readonly modelService: IModelService;
    private readonly writerPrompt: string;
    private readonly menuMaxEntries: number;
    private readonly onRelease?: () => void;
    private isRunning = false;
    private releaseRequested = false;

    constructor(
        @inject(IMemoryStore) private readonly store: IMemoryStore,
        @inject(T_MemoryReadTemplate) private readonly readTemplate: string,
        @inject(T_MemoryWriterPrompt) writerPrompt: string,
        @inject(IModelService) modelService: IModelService,
        @inject(T_MemoryMenuMaxEntries, { optional: true }) menuMaxEntries?: number,
        @inject(T_MemoryOnRelease, { optional: true }) onRelease?: () => void,
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
    ) {
        this.logger = loggerService?.getLogger("MemoryService");
        this.modelService = modelService;
        this.writerPrompt = writerPrompt;
        this.menuMaxEntries = menuMaxEntries ?? DEFAULT_MENU_LIMIT;
        this.onRelease = onRelease;
    }

    // ── 读路径 ──

    async getSystemMessage(): Promise<string | null> {
        const menu = await this.store.listMenu(DEFAULT_MENU_LIMIT);
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
            this.logger?.warn(`MemoryService.readMemory: recordRead failed for ${slug}: ${e?.message}`);
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

    // ── 写路径：入队 + 串行消费 ──

    async extractFromConversation(messages: ChatMessage[]): Promise<void> {
        if (messages.length === 0) return;
        this.store.pushPendingMessages(messages, Date.now());
        this.kick();
    }

    listPending(limit?: number): PendingMessageRow[] {
        return this.store.listPendingMessages(limit ?? 50);
    }

    processPending(): void {
        this.kick();
    }

    /**
     * 上层（pool）通知：可以释放本 service。
     * 设标记 + kick；drain 完成（或当下队列已空）时由 checkMessages 回调 onRelease。
     */
    requestRelease(): void {
        if (this.releaseRequested) return;
        this.releaseRequested = true;
        this.kick();
    }

    /**
     * 触发一次 checkMessages：已在跑则短路，否则后台启动一轮 drain。
     * 同步函数——`if (isRunning) return` 与 checkMessages 调用之间无 await 缝隙。
     */
    private kick(): void {
        if (this.isRunning) return;
        this.checkMessages().catch(() => undefined);
    }

    /**
     * 串行消费 pending 队列：循环 popOldestPending → 处理 → 删行 / 标 failed。
     *
     * 单标志 isRunning 足够，无需 pendingWakeup：
     * - kick 是同步设置 isRunning=true 后才 await，外部并发的 kick 全部短路；
     * - 在 drain 退出和 isRunning=false 之间没有 microtask 缝隙；
     * - 任何 push 都是先同步 SQL INSERT 再 kick；如果当前在跑，下一轮循环必然 pop 到；
     *   如果当前不在跑（已退出），kick 进入新一轮 drain。
     */
    private async checkMessages(): Promise<void> {
        this.isRunning = true;
        try {
            while (true) {
                const next = this.store.popOldestPending();
                if (!next) break;
                try {
                    const stats = await this.extractFromMessages(next.messages);
                    this.store.deletePending(next.id);
                    this.logger?.info(
                        `memory pending #${next.id} done: ` +
                        `create:${stats.create}/update:${stats.update}/delete:${stats.delete}/noop:${stats.noop}/failed:${stats.failed}`
                    );
                } catch (e: any) {
                    const errMsg = (e?.message ?? String(e)).slice(0, 1000);
                    try { this.store.markPendingFailed(next.id, errMsg, Date.now()); } catch { /* swallow */ }
                    this.logger?.warn(`memory pending #${next.id} extraction failed: ${errMsg}`);
                }
            }
        } finally {
            this.isRunning = false;
        }
        // 队列抽干 + 上层请求过 release → 主动通知 pool 完成 dispose；fire 一次后清标记
        if (this.releaseRequested) {
            this.releaseRequested = false;
            try {
                this.onRelease?.();
            } catch (e: any) {
                this.logger?.warn(`memory onRelease callback threw: ${e?.message ?? e}`);
            }
        }
    }

    // ── MemoryLLM CRUD 抽取（原 MemoryWriterWorker） ──

    /**
     * 单轮抽取：把一组对话消息喂给 MemoryLLM，应用返回的 ops。
     * 模型调用失败会抛出，由 checkMessages 决定是否标记 pending 行为 failed。
     */
    private async extractFromMessages(messages: ChatMessage[]): Promise<MemoryWriterOpStats> {
        if (messages.length === 0) {
            return { create: 0, update: 0, delete: 0, noop: 1, failed: 0 };
        }

        const conversation = renderConversation(messages);
        const menu = await this.store.listMenu(this.menuMaxEntries);
        const input = renderWriterInput(menu, conversation);

        const llmMessages: ChatMessage[] = [
            { role: MessageRole.System, content: this.writerPrompt },
            { role: MessageRole.Human, content: input },
        ];

        const result = await this.modelService.invokeStructured<MemoryWriteOutput>(MemoryWriteOutputSchema, llmMessages);
        return await this.applyOps(result.ops, { conversation, mergeUpdateBodies: true });
    }

    async consolidate(): Promise<MemoryWriterOpStats> {
        const rows = (await this.store.list()).slice(0, 100);
        if (rows.length === 0) return { create: 0, update: 0, delete: 0, noop: 1, failed: 0 };

        const bodyMaxChars = 1500;
        const entries = rows.map(r => [
            `## ${r.slug}`,
            `kind: ${r.kind}`,
            `title: ${r.title}`,
            `description: ${r.description}`,
            `evidence_count: ${r.evidenceCount}`,
            `updated_at: ${new Date(r.updatedAt).toISOString()}`,
            ``,
            truncate(r.body, bodyMaxChars),
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

        let result: MemoryWriteOutput;
        try {
            result = await this.modelService.invokeStructured<MemoryWriteOutput>(MemoryWriteOutputSchema, messages);
        } catch (e: any) {
            this.logger?.warn(`Memory consolidation model call failed: ${e?.message ?? e}`);
            return { create: 0, update: 0, delete: 0, noop: 0, failed: 1 };
        }

        const filtered = result.ops.filter(op => op.action !== MemoryOpAction.Create);
        return this.applyOps(filtered, { mergeUpdateBodies: false });
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
                        this.logger?.info(`memory create: ${op.slug} — ${op.title}`);
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
                        this.logger?.info(`memory update: ${op.slug} — ${op.reason}`);
                        break;
                    case MemoryOpAction.Delete:
                        await this.store.softDelete(op.slug, now);
                        out.delete++;
                        this.logger?.info(`memory delete: ${op.slug} — ${op.reason}`);
                        break;
                    case MemoryOpAction.Noop:
                        out.noop++;
                        this.logger?.info(`memory noop: ${op.reason}`);
                        break;
                }
            } catch (e: any) {
                out.failed++;
                this.logger?.warn(`memory op ${op.action}(${('slug' in op) ? op.slug : ''}) failed: ${e?.message ?? e}`);
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
            this.logger?.warn(`memory update merge failed for ${op.slug}: ${e?.message ?? e}`);
            // 保护旧 body：merge 失败时只应用 title/description/kind，不直接替换正文。
            return {
                ...op,
                body: undefined,
                bodyMode: undefined,
            };
        }
    }
}

// ── transcript 渲染（原 ConversationRenderer） ──

/**
 * 把一组 ChatMessage 渲染成可喂给 MemoryLLM 的纯文本 transcript。
 * system 角色的消息会被忽略。
 */
function renderConversation(messages: ChatMessage[]): string {
    const lines: string[] = [];
    for (const msg of messages) {
        const line = renderMessage(msg);
        if (line) lines.push(line);
    }
    return lines.join("\n\n");
}

function renderMessage(msg: ChatMessage): string | null {
    const role = roleLabel(msg.role);
    if (!role) return null;
    const text = contentToString(msg.content) || "";

    if (msg.role === MessageRole.AI && msg.tool_calls && msg.tool_calls.length > 0) {
        const calls = msg.tool_calls.map(c => `${c.name}(${safeJson(c.args)})`).join(", ");
        if (text) {
            return `ai: ${text}\n  tool_calls: ${calls}`;
        }
        return `ai (tool_calls): ${calls}`;
    }

    if (msg.role === MessageRole.Tool) {
        const name = msg.name ?? "tool";
        const status = msg.status ? ` [${msg.status}]` : "";
        return `tool[${name}]${status}: ${text}`;
    }

    return `${role}: ${text}`;
}

function roleLabel(role: MessageRole): string | null {
    switch (role) {
        case MessageRole.Human:  return "human";
        case MessageRole.AI:     return "ai";
        case MessageRole.Tool:   return "tool";
        case MessageRole.System: return null;  // system 不进 transcript
        default:                 return null;
    }
}

function safeJson(value: unknown): string {
    try {
        const s = JSON.stringify(value);
        if (s == null) return "";
        return s.length > 2048 ? s.slice(0, 2048) + "...<truncated>" : s;
    } catch {
        return "<unserializable>";
    }
}

function renderWriterInput(menu: MemoryMenuEntry[], conversation: string): string {
    const menuLines = menu.length === 0
        ? '_(no existing memories)_'
        : menu.map(m => `- [${m.kind}; evidence=${m.evidenceCount}] ${m.slug} — ${m.description}`).join('\n');

    return [
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
}

function truncate(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars) + `\n...<truncated>`;
}
