import { z } from "zod";
import { IModelService } from "../Model";
import { type ChatMessage, type StoredMessage, MessageRole } from "../Saver";
import { ILogger, ILoggerService } from "../Logger";
import { MemoryKind, type IMemoryStore, type ExtractJobRow, type MemoryBodyMode } from "./IMemoryStore";
import { renderConversation } from "./ConversationRenderer";
import { SecretRedactor } from "./SecretRedactor";

// 与 prompts/memory/writer/default.md 中描述的 CRUD schema 对齐。
// LLM 被强制走 invokeStructured，schema 不匹配时框架内部会重试。
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

const MemoryOpSchema = z.discriminatedUnion('action', [CreateOp, UpdateOp, DeleteOp, NoopOp]);
const MemoryWriteOutputSchema = z.object({
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

interface MemoryOpApplyContext {
    sourceThreadId?: string;
    sourceWindowStartCursor?: string;
    sourceWindowEndCursor?: string;
    conversation?: string;
    mergeUpdateBodies?: boolean;
}

export interface MemoryWriterJobContext {
    /** 来自 saver 的窗口内消息（未经 redact） */
    messages: StoredMessage[];
}

export interface MemoryWriterRunOptions {
    /** lease 持有时长，超时后未完成的 job 被下一轮重抢 */
    leaseMs: number;
    /** 同时跑几条 job */
    concurrency: number;
    /** 单 job 最大尝试次数；超过后 nextRetryAt=null 不再被 claim */
    maxAttempts: number;
    /** menu 注入给 LLM 时的最大条目数（控 token） */
    menuMaxEntries: number;
    /** 给定 job，从 saver 拉对应窗口的消息；返回 null 表示该窗口无效 */
    fetchJobContext: (job: ExtractJobRow) => Promise<MemoryWriterJobContext | null>;
}

export interface MemoryWriterStats {
    claimed: number;
    succeeded: number;
    failed: number;
    /** 应用的 op 计数（按 action 分类，覆盖所有 succeeded 的 job） */
    ops: { create: number; update: number; delete: number; noop: number; failed: number };
}

/**
 * MemoryLLM CRUD worker。一个 memoryProfile 一个实例。
 *
 * 流程：
 *   1. claim 一批 pending job（含过期 lease 重抢、failed 重试）
 *   2. for each job：
 *      a. fetch transcript（saver）
 *      b. 渲染 input（菜单 + transcript）
 *      c. SecretRedactor 兜底
 *      d. 调 LLM，强制结构化输出（CRUD ops 数组）
 *      e. 应用每条 op（独立 try/catch；单条失败不影响其他）
 *      f. 标记 job succeeded
 *   3. 模型调用整体失败 → finishExtractFailure，按指数 backoff 等下一轮
 *
 * 直接产生 CRUD ops 应用到 store；没有整合层，每条 op 即时落盘；
 * 单 op 失败隔离（如 slug 冲突）不会让整个 job 标 failed。
 */
export class MemoryWriterWorker {
    private logger?: ILogger;

    constructor(
        private readonly modelService: IModelService,
        private readonly store: IMemoryStore,
        private readonly systemPrompt: string,
        private readonly redactor: SecretRedactor,
        loggerService?: ILoggerService,
    ) {
        this.logger = loggerService?.getLogger("MemoryWriterWorker");
    }

    async runOnce(opts: MemoryWriterRunOptions): Promise<MemoryWriterStats> {
        const stats: MemoryWriterStats = {
            claimed: 0,
            succeeded: 0,
            failed: 0,
            ops: { create: 0, update: 0, delete: 0, noop: 0, failed: 0 },
        };
        const claimed = await this.store.claimExtract(Date.now(), opts.leaseMs, opts.concurrency);
        stats.claimed = claimed.length;
        if (claimed.length === 0) return stats;

        const results = await Promise.allSettled(claimed.map(job => this.processOne(job, opts)));
        for (let i = 0; i < results.length; i++) {
            const r = results[i];
            if (r.status === 'fulfilled') {
                if (r.value.kind === 'succeeded') {
                    stats.succeeded++;
                    stats.ops.create += r.value.ops.create;
                    stats.ops.update += r.value.ops.update;
                    stats.ops.delete += r.value.ops.delete;
                    stats.ops.noop   += r.value.ops.noop;
                    stats.ops.failed += r.value.ops.failed;
                } else {
                    stats.failed++;
                }
            } else {
                stats.failed++;
                this.logger?.error(`MemoryWriter job ${claimed[i].id} processing rejected: ${r.reason?.message ?? r.reason}`);
            }
        }
        return stats;
    }

    private async processOne(
        job: ExtractJobRow,
        opts: MemoryWriterRunOptions,
    ): Promise<{ kind: 'succeeded'; ops: MemoryWriterStats['ops'] } | { kind: 'failed' }> {
        const ctx = await opts.fetchJobContext(job).catch(e => {
            this.logger?.warn(`fetchJobContext failed for job ${job.id}: ${e?.message}`);
            return null;
        });

        if (!ctx || ctx.messages.length === 0) {
            // 窗口空（session 已删 / saver 失效）→ 无可处理内容，job 完结，不重试
            await this.store.finishExtractSuccess(job.id, Date.now());
            return { kind: 'succeeded', ops: { create: 0, update: 0, delete: 0, noop: 1, failed: 0 } };
        }

        const conversation = renderConversation(ctx.messages);
        const menu = await this.store.listMenu(opts.menuMaxEntries);
        const input = this.renderInput(menu, conversation);
        const redacted = this.redactor.redact(input);

        const messages: ChatMessage[] = [
            { role: MessageRole.System, content: this.systemPrompt },
            { role: MessageRole.Human, content: redacted },
        ];

        let result: MemoryWriteOutput;
        try {
            result = await this.modelService.invokeStructured<MemoryWriteOutput>(MemoryWriteOutputSchema, messages);
        } catch (e: any) {
            const attemptsTried = job.attemptCount; // claim 时已 +1
            const nextRetryAt = attemptsTried >= opts.maxAttempts ? null : Date.now() + this.backoffMs(attemptsTried);
            const errMsg = (e?.message ?? String(e)).slice(0, 1000);
            await this.store.finishExtractFailure(job.id, errMsg, nextRetryAt, Date.now());
            this.logger?.warn(`MemoryWriter job ${job.id} model call failed (attempt ${attemptsTried}/${opts.maxAttempts}): ${errMsg}`);
            return { kind: 'failed' };
        }

        const opStats = await this.applyOps(job.id, result.ops, {
            sourceThreadId: job.threadId,
            sourceWindowStartCursor: job.windowStartCursor,
            sourceWindowEndCursor: job.windowEndCursor,
            conversation,
            mergeUpdateBodies: true,
        });
        await this.store.finishExtractSuccess(job.id, Date.now());
        return { kind: 'succeeded', ops: opStats };
    }

    async consolidateOnce(opts?: { entryLimit?: number; bodyMaxChars?: number }): Promise<MemoryWriterStats['ops']> {
        const rows = (await this.store.list()).slice(0, opts?.entryLimit ?? 100);
        if (rows.length === 0) return { create: 0, update: 0, delete: 0, noop: 1, failed: 0 };

        const bodyMaxChars = opts?.bodyMaxChars ?? 1500;
        const entries = rows.map(r => [
            `## ${r.slug}`,
            `kind: ${r.kind}`,
            `title: ${r.title}`,
            `description: ${r.description}`,
            `evidence_count: ${r.evidenceCount}`,
            `updated_at: ${new Date(r.updatedAt).toISOString()}`,
            ``,
            this.truncate(r.body, bodyMaxChars),
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
        return this.applyOps(-1, filtered, { mergeUpdateBodies: false });
    }

    /**
     * 单 op 失败不破坏整体：每条独立 try/catch。
     * 失败原因（slug 冲突 / 不存在等）记 warn 日志，整体 job 仍标 succeeded。
     */
    private async applyOps(jobId: number, ops: MemoryOp[], context: MemoryOpApplyContext = {}): Promise<MemoryWriterStats['ops']> {
        const out = { create: 0, update: 0, delete: 0, noop: 0, failed: 0 };
        const now = Date.now();
        const source = context.sourceThreadId
            ? {
                threadId: context.sourceThreadId,
                windowStartCursor: context.sourceWindowStartCursor,
                windowEndCursor: context.sourceWindowEndCursor,
            }
            : undefined;
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
                            source,
                            evidenceCount: source ? 1 : undefined,
                        }, now);
                        out.create++;
                        this.logger?.info(`[job ${jobId}] memory create: ${op.slug} — ${op.title}`);
                        break;
                    case MemoryOpAction.Update:
                        const update = context.mergeUpdateBodies && op.body
                            ? await this.mergeUpdateBody(jobId, op, context)
                            : op;
                        await this.store.update({
                            slug: update.slug,
                            kind: update.kind as MemoryKind | undefined,
                            title: update.title,
                            description: update.description,
                            body: update.body,
                            bodyMode: update.bodyMode as MemoryBodyMode | undefined,
                            source,
                            evidenceDelta: source ? 1 : 0,
                        }, now);
                        out.update++;
                        this.logger?.info(`[job ${jobId}] memory update: ${op.slug} — ${op.reason}`);
                        break;
                    case MemoryOpAction.Delete:
                        await this.store.softDelete(op.slug, now);
                        out.delete++;
                        this.logger?.info(`[job ${jobId}] memory delete: ${op.slug} — ${op.reason}`);
                        break;
                    case MemoryOpAction.Noop:
                        out.noop++;
                        this.logger?.info(`[job ${jobId}] memory noop: ${op.reason}`);
                        break;
                }
            } catch (e: any) {
                out.failed++;
                this.logger?.warn(`[job ${jobId}] op ${op.action}(${('slug' in op) ? op.slug : ''}) failed: ${e?.message ?? e}`);
            }
        }
        return out;
    }

    private async mergeUpdateBody(
        jobId: number,
        op: Extract<MemoryOp, { action: MemoryOpAction.Update }>,
        context: MemoryOpApplyContext,
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
                    context.conversation ?? '',
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
            this.logger?.warn(`[job ${jobId}] memory update merge failed for ${op.slug}: ${e?.message ?? e}`);
            // 保护旧 body：merge 失败时只应用 title/description/kind，不直接替换正文。
            return {
                ...op,
                body: undefined,
                bodyMode: undefined,
            };
        }
    }

    private renderInput(menu: Awaited<ReturnType<IMemoryStore['listMenu']>>, conversation: string): string {
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

    /** 指数退避：1min, 5min, 30min（attemptsTried 从 1 起）。 */
    private backoffMs(attemptsTried: number): number {
        const ladder = [60_000, 5 * 60_000, 30 * 60_000];
        const idx = Math.max(0, Math.min(ladder.length - 1, attemptsTried - 1));
        return ladder[idx];
    }

    private truncate(text: string, maxChars: number): string {
        if (text.length <= maxChars) return text;
        return text.slice(0, maxChars) + `\n...<truncated>`;
    }
}

// re-export schema 给其他模块（admin 调试 / 测试用）
export { MemoryOpSchema, MemoryWriteOutputSchema };
