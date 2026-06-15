import {
    type IMemoryStore,
    type MemoryWriterWorker,
    type MemoryWriterJobContext,
    type ExtractJobRow,
    type StoredMessage,
    countTurns,
    MessageKind,
    MessageRole,
} from "scorpio.ai";
import type { MemoryProfileConfig } from "sbot.commons";
import { LoggerService } from "../Core/LoggerService";
import { channelDataService, type MemorySessionCandidate } from "../Session/ChannelDataService";
import { SaverPool } from "../Agent/SaverPool";

const logger = LoggerService.getLogger("Memory/MemoryExtractScheduler");

/** Worker lease 长度——超过这个时间未完成 job 会被下一轮 claim 抢走。 */
const EXTRACT_LEASE_MS = 5 * 60 * 1000;
/** Scheduler tick 间隔——每 60s 扫一次绑定该 memoryId 的 sessions。 */
const EXTRACT_TICK_MS = 60 * 1000;

/**
 * 单 memoryId 的抽取调度器。
 *
 * 每 EXTRACT_TICK_MS：
 *   1. 扫描所有绑定该 memoryId 的 sessions
 *   2. 对满足 idle / windowMaxMessages 阈值的 session enqueue 下一段抽取 job
 *   3. 调 worker.runOnce 处理积压 + 新入队的 job
 *
 * 触发逻辑：每 60s 扫绑定该 memoryId 的 sessions，对满足 idle / windowMaxMessages
 * 阈值的 session enqueue 下一段抽取 job；切片优先落在 turn 边界，调 worker.runOnce
 * 处理积压 + 新入队的 job。
 */
export class MemoryExtractScheduler {
    private timer: NodeJS.Timeout | null = null;
    private running = false;
    private readonly saverPool = SaverPool.getInstance();

    constructor(
        private readonly memoryId: string,
        private readonly profile: MemoryProfileConfig,
        private readonly store: IMemoryStore,
        private readonly worker: MemoryWriterWorker,
    ) {}

    start(): void {
        if (this.timer) return;
        // 启动后立刻 tick 一次（无需等 60s），便于发现已积压的 retry job
        this.tick().catch(e => logger.error(`initial tick failed [${this.memoryId}]: ${e?.message ?? e}`));
        this.timer = setInterval(() => {
            this.tick().catch(e => logger.error(`tick failed [${this.memoryId}]: ${e?.message ?? e}`));
        }, EXTRACT_TICK_MS);
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    /** admin 手动触发一轮（绕过 timer，立刻扫 + 处理）。 */
    async runOnce(options?: { forceReady?: boolean }): Promise<void> {
        await this.tick(options);
    }

    private async tick(options?: { forceReady?: boolean }): Promise<void> {
        if (this.running) return;
        this.running = true;
        try {
            await this.enqueueIdleSessions(options);
            const stats = await this.worker.runOnce({
                leaseMs: EXTRACT_LEASE_MS,
                concurrency: this.profile.writerConcurrency ?? 3,
                maxAttempts: this.profile.jobMaxAttempts ?? 3,
                menuMaxEntries: this.profile.writerMemoryMenuMaxEntries ?? 200,
                fetchJobContext: (job) => this.fetchJobContext(job),
            });
            if (stats.claimed > 0) {
                logger.info(
                    `[${this.memoryId}] memory writer: claimed=${stats.claimed} succeeded=${stats.succeeded} failed=${stats.failed} ` +
                    `ops=create:${stats.ops.create}/update:${stats.ops.update}/delete:${stats.ops.delete}/noop:${stats.ops.noop}/failed:${stats.ops.failed}`
                );
            }
        } finally {
            this.running = false;
        }
    }

    private async enqueueIdleSessions(options?: { forceReady?: boolean }): Promise<void> {
        const candidates = await channelDataService.listSessionsByMemory(this.memoryId);
        if (candidates.length === 0) return;

        const now = Date.now();
        const idleMs = Math.max(1, this.profile.idleMinutes ?? 10) * 60_000;
        const windowMaxMessages = Math.max(1, this.profile.windowMaxMessages ?? 50);

        for (const candidate of candidates) {
            try {
                await this.tryEnqueueOne(candidate, now, idleMs, windowMaxMessages, !!options?.forceReady);
            } catch (e: any) {
                logger.warn(`[${this.memoryId}] enqueue scan failed for thread=${candidate.threadId}: ${e?.message ?? e}`);
            }
        }
    }

    private async tryEnqueueOne(
        candidate: MemorySessionCandidate,
        now: number,
        idleMs: number,
        windowMaxMessages: number,
        forceReady: boolean,
    ): Promise<void> {
        const lastCursor = await this.store.findLatestCompletedWindowEnd(candidate.threadId);
        const startCursor = lastCursor ?? "";
        const startId = startCursor ? Number(startCursor) : 0;

        const handle = await this.saverPool.acquireByDBSessionId(candidate.channelSessionId);
        try {
            const allMessages = await handle.saver.getAllMessages(false);
            const window = allMessages.filter(m => m.id > startId);
            if (window.length === 0) return;

            const newest = window[window.length - 1];
            const newestUserTime = lastUserMessageTimestamp(window);
            const idle = newestUserTime !== null && (now - newestUserTime) >= idleMs;
            const sizeReached = window.length >= windowMaxMessages;
            if (!forceReady && !idle && !sizeReached) return;

            const slice = sliceAtTurnBoundary(window, windowMaxMessages, idle || forceReady);
            if (slice.length === 0) return;
            const endCursor = String(slice[slice.length - 1].id);
            const turnCount = countTurns(slice);
            const rolloutKey = `${candidate.threadId}:${startCursor || "0"}:${endCursor}`;

            await this.store.enqueueExtract({
                threadId: candidate.threadId,
                rolloutKey,
                windowStartCursor: startCursor,
                windowEndCursor: endCursor,
                turnCount,
            }, now);
        } finally {
            await handle.release().catch(() => undefined);
        }
    }

    /** 给定 job，重新打开 saver 取出窗口内消息——交给 worker 渲染 + 调 LLM。 */
    private async fetchJobContext(job: ExtractJobRow): Promise<MemoryWriterJobContext | null> {
        const candidate = await this.resolveCandidateByThread(job.threadId);
        if (!candidate) return null;

        const handle = await this.saverPool.acquireByDBSessionId(candidate.channelSessionId).catch(e => {
            logger.warn(`[${this.memoryId}] saver acquire failed for thread=${job.threadId}: ${e?.message ?? e}`);
            return null;
        });
        if (!handle) return null;

        try {
            const allMessages = await handle.saver.getAllMessages(false);
            const startId = job.windowStartCursor ? Number(job.windowStartCursor) : 0;
            const endId = Number(job.windowEndCursor);
            const messages = allMessages.filter(m => m.id > startId && m.id <= endId && m.kind === MessageKind.Normal);
            return { messages };
        } finally {
            await handle.release().catch(() => undefined);
        }
    }

    private async resolveCandidateByThread(threadId: string): Promise<MemorySessionCandidate | null> {
        const candidates = await channelDataService.listSessionsByMemory(this.memoryId);
        return candidates.find(c => c.threadId === threadId) ?? null;
    }
}

function lastUserMessageTimestamp(messages: StoredMessage[]): number | null {
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].message.role === MessageRole.Human) return messages[i].createdAt;
    }
    return null;
}

function sliceAtTurnBoundary(messages: StoredMessage[], windowMaxMessages: number, allowOpenTail: boolean): StoredMessage[] {
    const limit = Math.min(windowMaxMessages, messages.length);
    const boundaryBeforeLimit = findLastTurnBoundaryBefore(messages, limit);
    if (boundaryBeforeLimit > 0) return messages.slice(0, boundaryBeforeLimit);

    const boundaryAfterLimit = findNextTurnBoundaryAtOrAfter(messages, limit);
    if (boundaryAfterLimit > 0) return messages.slice(0, boundaryAfterLimit);

    return allowOpenTail ? messages : [];
}

function findLastTurnBoundaryBefore(messages: StoredMessage[], limitExclusive: number): number {
    let boundary = 0;
    for (let i = 1; i < limitExclusive && i < messages.length; i++) {
        if (messages[i].message.role === MessageRole.Human) boundary = i;
    }
    return boundary;
}

function findNextTurnBoundaryAtOrAfter(messages: StoredMessage[], startIndex: number): number {
    for (let i = Math.max(1, startIndex); i < messages.length; i++) {
        if (messages[i].message.role === MessageRole.Human) return i;
    }
    return 0;
}
