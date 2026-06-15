import { z } from "zod";
import { IModelService } from "../Model";
import { type ChatMessage, type StoredMessage, MessageKind, MessageRole } from "../Saver";
import { ILogger, ILoggerService } from "../Logger";
import { MemoryKind, type IMemoryStore, type MemoryBodyMode } from "./IMemoryStore";
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
    conversation?: string;
    mergeUpdateBodies?: boolean;
}

export interface MemoryWriterOpStats {
    create: number;
    update: number;
    delete: number;
    noop: number;
    failed: number;
}

const DEFAULT_MENU_MAX_ENTRIES = 200;

/**
 * MemoryLLM CRUD 引擎。一个 memoryProfile 一个实例，由 MemoryService 持有并调用。
 *
 * 流程（每次 extractFromMessages）：
 *   1. 渲染 input（菜单 + transcript）
 *   2. SecretRedactor 兜底
 *   3. 调 LLM，强制结构化输出（CRUD ops 数组）
 *   4. 应用每条 op（独立 try/catch；单条失败不影响其他）
 *
 * 直接产生 CRUD ops 应用到 store；没有整合层，每条 op 即时落盘；
 * 单 op 失败隔离（如 slug 冲突）不会让整个调用抛错。
 */
export class MemoryWriterWorker {
    private logger?: ILogger;

    constructor(
        private readonly modelService: IModelService,
        private readonly store: IMemoryStore,
        private readonly systemPrompt: string,
        private readonly redactor: SecretRedactor,
        private readonly menuMaxEntries: number = DEFAULT_MENU_MAX_ENTRIES,
        loggerService?: ILoggerService,
    ) {
        this.logger = loggerService?.getLogger("MemoryWriterWorker");
    }

    /**
     * 单轮抽取：把一组对话消息喂给 MemoryLLM，应用返回的 ops。
     * 模型调用失败会抛出，由调用方决定是否标记 pending 行为 failed。
     */
    async extractFromMessages(messages: ChatMessage[]): Promise<MemoryWriterOpStats> {
        if (messages.length === 0) {
            return { create: 0, update: 0, delete: 0, noop: 1, failed: 0 };
        }

        const conversation = this.renderChatMessages(messages);
        const menu = await this.store.listMenu(this.menuMaxEntries);
        const input = this.renderInput(menu, conversation);
        const redacted = this.redactor.redact(input);

        const llmMessages: ChatMessage[] = [
            { role: MessageRole.System, content: this.systemPrompt },
            { role: MessageRole.Human, content: redacted },
        ];

        const result = await this.modelService.invokeStructured<MemoryWriteOutput>(MemoryWriteOutputSchema, llmMessages);
        return await this.applyOps(result.ops, { conversation, mergeUpdateBodies: true });
    }

    async consolidateOnce(opts?: { entryLimit?: number; bodyMaxChars?: number }): Promise<MemoryWriterOpStats> {
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
        return this.applyOps(filtered, { mergeUpdateBodies: false });
    }

    /**
     * 单 op 失败不破坏整体：每条独立 try/catch。
     * 失败原因（slug 冲突 / 不存在等）记 warn 日志。
     */
    private async applyOps(ops: MemoryOp[], context: MemoryOpApplyContext = {}): Promise<MemoryWriterOpStats> {
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
                            ? await this.mergeUpdateBody(op, context)
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
            this.logger?.warn(`memory update merge failed for ${op.slug}: ${e?.message ?? e}`);
            // 保护旧 body：merge 失败时只应用 title/description/kind，不直接替换正文。
            return {
                ...op,
                body: undefined,
                bodyMode: undefined,
            };
        }
    }

    /** 把 ChatMessage[] 包成 StoredMessage[] 喂给 renderConversation；timestamp 统一用 now。 */
    private renderChatMessages(messages: ChatMessage[]): string {
        const now = Date.now();
        const stored: StoredMessage[] = messages.map((message, i) => ({
            id: i,
            message,
            createdAt: now,
            kind: MessageKind.Normal,
        }));
        return renderConversation(stored);
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

    private truncate(text: string, maxChars: number): string {
        if (text.length <= maxChars) return text;
        return text.slice(0, maxChars) + `\n...<truncated>`;
    }
}

// re-export schema 给其他模块（admin 调试 / 测试用）
export { MemoryOpSchema, MemoryWriteOutputSchema };
