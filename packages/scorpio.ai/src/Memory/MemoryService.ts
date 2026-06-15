import { inject } from "scorpio.di";
import {
    T_MemoryReadTemplate,
    T_MemoryWriterPrompt,
    T_MemoryMenuMaxEntries,
    T_MemoryOnRelease,
} from "../Core/tokens";
import { ILogger, ILoggerService } from "../Logger";
import { IModelService } from "../Model";
import {
    IMemoryService,
    type MemoryToolDescs,
} from "./IMemoryService";
import {
    IMemoryStore,
    type MemoryRow,
    type MemorySearchHit,
    type PendingMessageRow,
} from "./IMemoryStore";
import { MemoryWriterWorker, type MemoryWriterOpStats } from "./MemoryWriterWorker";
import { SecretRedactor } from "./SecretRedactor";
import type { ChatMessage } from "../Saver";

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

/**
 * Memory 系统的运行时 facade。每个 memoryProfile 一个实例（由 sbot 侧 MemoryServicePool 管理）。
 *
 * 三个职责：
 * - 渲染注入用的 menu prompt（替换 {{ memory_menu }}）
 * - 透传 readMemory / search 给 store
 * - 串行抽取：每轮对话结束 push 进 SQLite 队列，内部 isRunning 标志保证同 profile 只一个 LLM 调用在跑
 *
 * 互斥模型：
 * - 每个 memoryId 一个 MemoryService 实例（pool 维护）
 * - 多 session 同时调 extractFromConversation：push 互不阻塞，checkMessages 串行消费
 * - isRunning 用进程内 flag；进程崩溃后未处理的 pending 行下次启动还能看到（pop 顺序消费）
 */
export class MemoryService implements IMemoryService {
    private logger?: ILogger;
    private readonly worker: MemoryWriterWorker;
    private readonly onRelease?: () => void;
    private isRunning = false;
    private pendingWakeup = false;
    private runningPromise?: Promise<void>;
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
        this.onRelease = onRelease;
        this.worker = new MemoryWriterWorker(
            modelService,
            this.store,
            writerPrompt,
            new SecretRedactor(),
            menuMaxEntries ?? DEFAULT_MENU_LIMIT,
            loggerService,
        );
    }

    async getMemoryMenuPrompt(): Promise<string> {
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

    async extractFromConversation(messages: ChatMessage[]): Promise<void> {
        if (messages.length === 0) return;
        await this.store.pushPendingMessages(messages, Date.now());
        this.pendingWakeup = true;
        if (!this.isRunning) {
            this.runningPromise = this.checkMessages();
            // 后台跑，不阻塞调用方；错误已在 checkMessages 内 catch
            this.runningPromise.catch(() => undefined);
        }
    }

    /**
     * 串行消费 pending 队列。
     * - 用 isRunning + pendingWakeup 双标志避免漏单：
     *   pop 看不到新行但同时新 push 已写库，
     *   只要 push 能在 isRunning 翻回 false 之前观察到 isRunning=true，
     *   它就会设置 pendingWakeup，本轮外层 while 会再扫一次。
     * - 失败行标 'failed' 保留数据，不再自动重试，由 admin 决定。
     */
    private async checkMessages(): Promise<void> {
        if (this.isRunning) return;
        this.isRunning = true;
        try {
            while (this.pendingWakeup) {
                this.pendingWakeup = false;
                while (true) {
                    const next = await this.store.popOldestPending();
                    if (!next) break;
                    try {
                        const stats = await this.worker.extractFromMessages(next.messages);
                        await this.store.deletePending(next.id);
                        this.logger?.info(
                            `memory pending #${next.id} done: ` +
                            `create:${stats.create}/update:${stats.update}/delete:${stats.delete}/noop:${stats.noop}/failed:${stats.failed}`
                        );
                    } catch (e: any) {
                        const errMsg = (e?.message ?? String(e)).slice(0, 1000);
                        await this.store.markPendingFailed(next.id, errMsg, Date.now()).catch(() => undefined);
                        this.logger?.warn(`memory pending #${next.id} extraction failed: ${errMsg}`);
                    }
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

    async listPending(limit?: number): Promise<PendingMessageRow[]> {
        return this.store.listPendingMessages(limit ?? 50);
    }

    async processPending(): Promise<void> {
        this.pendingWakeup = true;
        if (!this.isRunning) {
            this.runningPromise = this.checkMessages();
        }
        await this.runningPromise;
    }

    /**
     * 上层（pool）通知：可以释放本 service。
     * - 即便队列已空，也至少触发一次 checkMessages 让 onRelease fire；
     * - drain 期间被入队的新消息会一起处理，drain 完成后再回调；
     * - dedup：重复 requestRelease 在同一个未触发 fire 的窗口里只生效一次。
     */
    requestRelease(): void {
        if (this.releaseRequested) return;
        this.releaseRequested = true;
        this.pendingWakeup = true;
        if (!this.isRunning) {
            this.runningPromise = this.checkMessages();
            this.runningPromise.catch(() => undefined);
        }
    }

    async consolidate(): Promise<MemoryWriterOpStats> {
        return this.worker.consolidateOnce();
    }
}
