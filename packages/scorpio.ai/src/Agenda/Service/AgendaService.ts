import { inject } from "scorpio.di";
import { T_AgendaToolDescs, formatError } from "../../Core";
import { ILoggerService, type ILogger } from "../../Logger";
import type { ChatMessage } from "../../Saver";
import {
    AgendaAssignee,
    AgendaPriority,
    AgendaSource,
    AgendaStatus,
    AgendaTriggerAction,
    AgendaTriggerKind,
    type AgendaCreateArgs,
    type AgendaCreateResult,
    type AgendaItem,
    type AgendaListFilter,
    type AgendaRecord,
    type AgendaTrigger,
    type AgendaTriggerCreateArgs,
    type AgendaTriggerReplaceAllArgs,
    type AgendaTriggerSpec,
    type AgendaTriggerUpdatePatch,
    type AgendaUpdatePatch,
} from "../types";
import { formatAgendaListXml } from "../format";
import {
    DEFAULT_LIST_LIMIT,
    DEFAULT_PENDING_JOB_LIMIT,
    ERROR_MESSAGE_MAX_LEN,
    EXISTING_AGENDA_LIMIT,
} from "../limits";
import {
    type AgendaAction,
    AgendaActionType,
    IAgendaExtractor,
} from "../Extractor/IAgendaExtractor";
import { IAgendaTriggerEngine } from "../TriggerEngine/IAgendaTriggerEngine";
import { IAgendaStore, type PendingAgendaJobRow, AgendaPendingJobType } from "../Storage/IAgendaStore";
import { TimeUtils } from "../../Utils/TimeUtils";
import { computeInitialNextFire, relativeToMs } from "../time";
import { type AgendaToolDescs, IAgendaService } from "./IAgendaService";
import { agendaServicePool } from "./AgendaServicePool";

/**
 * Agenda 系统的运行时 facade。每个 agendaProfile 一个实例（由 sbot 侧 AgendaServicePool 管理）。
 *
 * 互斥模型（参考 MemoryService）：
 * - 每个 agendaId 一个 AgendaService 实例（pool 维护）
 * - 多 session 同时 extractFromConversation：push 互不阻塞，kick 后 checkJobs 串行 drain
 * - 单标志 isRunning 即可：单线程 JS + 同步 better-sqlite3 + microtask FIFO 保证
 *   "push 在 drain 退出后必然能再次 kick 起一轮"
 *
 * 与 MemoryService 的不同点：
 * - AgendaStore 由 sbot 侧 agendaStorePool 拥有并跨方共享（TriggerEngine / routes），
 *   release 归零时**不**关 store；只 evict 自己。
 */
export class AgendaService implements IAgendaService {
    private readonly logger?: ILogger;
    private isRunning = false;
    private refCount = 0;
    private disposed = false;

    constructor(
        @inject(T_AgendaToolDescs) private toolDescs: AgendaToolDescs,
        @inject(IAgendaStore) private agendaStore: IAgendaStore,
        @inject(IAgendaTriggerEngine) private triggerEngine: IAgendaTriggerEngine,
        @inject(IAgendaExtractor, { optional: true }) private extractor?: IAgendaExtractor,
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
    ) {
        this.logger = loggerService?.getLogger("AgendaService.ts");
    }

    // ── 生命周期：refCount 配对，归零一次性 evict ──

    /** Pool 在 acquire 时调用：refCount++。仅 pool 用，不在 IAgendaService 接口语义上向外暴露。 */
    incRef(): void {
        this.refCount++;
    }

    /** Caller 调用（AgentRunner finally）：refCount--，归零让 pool 驱逐自己。store 不在此关闭。 */
    release(): void {
        if (--this.refCount !== 0 || this.disposed) return;
        this.disposed = true;
        agendaServicePool.evict(this);
    }

    getToolDescs(): AgendaToolDescs {
        return this.toolDescs;
    }

    async create(args: AgendaCreateArgs): Promise<AgendaCreateResult> {
        const content = args.content?.trim();
        if (!content) throw new Error("content is required");
        const now = Date.now();
        const dueAt = this.inferDueAt(args, now);

        // findNearDuplicate + createItem + appendTrigger 必须原子，否则 tool 路径
        // 与 sync drain 各自检查后双写。runExclusive 让这一段共享同一把可重入锁。
        // triggerEngine.reload 放在锁外（它只读 store + 调度 timer，不属于"写入唯一性"问题）。
        const result = await this.agendaStore.runExclusive(async () => {
            const existing = await this.findNearDuplicate(content, dueAt);
            if (existing) return { record: existing, created: false as const, triggers: [] };

            const assignee = args.assignee ?? AgendaAssignee.User;
            const inserted = await this.agendaStore.createItem({
                content,
                status: AgendaStatus.Pending,
                priority: args.priority ?? AgendaPriority.Normal,
                assignee,
                // 仅 Other 归属保留名字，其余强制置空，避免脏数据。
                assigneeName: assignee === AgendaAssignee.Other ? (args.assigneeName?.trim() || null) : null,
                dueAt,
                source: args.source ?? AgendaSource.Tool,
                createdAt: now,
                updatedAt: now,
                doneAt: null,
            });

            // dueAt 仅作为「截止时刻」语义存储，不再派生默认 trigger。
            // 如果希望截止前/截止时被提醒，调用方需显式传 triggers。
            const triggers = await this.createTriggersIfNeeded(inserted.item, args, now);
            return { record: inserted, created: true as const, triggers };
        });

        if (!result.created) return { item: result.record, created: false, existed: true };
        for (const trigger of result.triggers) await this.triggerEngine.reload(trigger.id);
        const fresh = await this.agendaStore.findItem(result.record.item.id);
        return { item: fresh!, created: true, existed: false };
    }

    async list(filter?: AgendaListFilter): Promise<AgendaRecord[]> {
        return AgendaService.buildList(await this.agendaStore.listItems(), filter);
    }

    static buildList(records: AgendaRecord[], filter?: AgendaListFilter): AgendaRecord[] {
        const filtered = records.filter(r => AgendaService.matchesFilter(r, filter));
        filtered.sort((a, b) => {
            const an = AgendaService.firstNextFire(a) ?? a.item.dueAt ?? a.item.createdAt;
            const bn = AgendaService.firstNextFire(b) ?? b.item.dueAt ?? b.item.createdAt;
            if (a.item.status !== b.item.status) return a.item.status === AgendaStatus.Pending ? -1 : 1;
            return an - bn;
        });
        return filtered.slice(0, filter?.limit ?? DEFAULT_LIST_LIMIT);
    }

    async update(id: number, patch: AgendaUpdatePatch): Promise<AgendaRecord | null> {
        // 只改主体字段，不碰调度——trigger 的增改删走 addTrigger / updateTrigger / removeTrigger / replaceTriggers。
        // 仍进 runExclusive：与并发的 trigger 操作（同一 item 上 updateItem）串行化，避免 updatedAt 等写竞争。
        return this.agendaStore.runExclusive(async () => {
            const item = await this.loadItem(id);
            if (!item) return null;
            const now = Date.now();
            const fields: Partial<AgendaItem> = { updatedAt: now };
            if (patch.content != null && patch.content.trim()) fields.content = patch.content.trim();
            if (patch.priority != null) fields.priority = patch.priority;
            if (patch.dueAt !== undefined) {
                fields.dueAt = patch.dueAt === null ? null : TimeUtils.parseAt(patch.dueAt);
            }
            // 注意：仅改 dueAt 不会联动现有 trigger。如需调度同步，调用方应显式走 trigger 端点。
            const data = await this.agendaStore.updateItem(id, fields);
            if (!data?.item) return null;
            return this.agendaStore.findItem(id);
        });
    }

    async addTrigger(itemId: number, args: AgendaTriggerCreateArgs): Promise<AgendaRecord | null> {
        return this.agendaStore.runExclusive(async () => {
            const item = await this.loadItem(itemId);
            if (!item) return null;
            const now = Date.now();
            const trigger = await this.createTrigger(item, {
                content: item.content,
                priority: item.priority,
                triggers: [args],
                channelSessionId: args.channelSessionId,
            }, args, now);
            if (!trigger) return this.agendaStore.findItem(itemId);
            const dueAt = AgendaService.deriveDueAtFromSpec(args, now);
            await this.agendaStore.updateItem(itemId, {
                updatedAt: now,
                dueAt: this.mergeDueAt(item.dueAt, dueAt),
            });
            await this.triggerEngine.reload(trigger.id);
            return this.agendaStore.findItem(itemId);
        });
    }

    async updateTrigger(triggerId: number, patch: AgendaTriggerUpdatePatch): Promise<AgendaRecord | null> {
        return this.agendaStore.runExclusive(async () => {
            const found = await this.agendaStore.findTrigger(triggerId);
            if (!found) return null;
            const now = Date.now();
            const schedule = this.buildTriggerScheduleFields(patch, now);
            // schedule 构建不出来 = spec 无效（absolute 缺 at、cron expr 空、kind 不合法）。
            // 抛错而非静默返回旧记录——否则上层会误报"已更新"，LLM 以为改成功了实际什么都没动。
            if (!schedule) throw new Error(`Invalid trigger spec for #${triggerId}: cannot build schedule (check kind / at / expr).`);
            const fields: Partial<AgendaTrigger> = {
                ...schedule,
                enabled: true,
                fireCount: 0,
                lastFiredAt: null,
                action: patch.action ?? AgendaTriggerAction.Notify,
                message: patch.message.trim(),
            };
            if (patch.channelSessionId !== undefined) fields.channelSessionId = patch.channelSessionId;
            const record = await this.agendaStore.updateTrigger(triggerId, fields);
            await this.agendaStore.updateItem(found.data.item.id, { updatedAt: now });
            await this.triggerEngine.reload(triggerId);
            return record ? this.agendaStore.findItem(found.data.item.id) : null;
        });
    }

    async removeTrigger(triggerId: number): Promise<AgendaRecord | null> {
        return this.agendaStore.runExclusive(async () => {
            const found = await this.agendaStore.findTrigger(triggerId);
            if (!found) return null;
            const now = Date.now();
            const record = await this.agendaStore.updateTrigger(triggerId, {
                enabled: false,
                nextFireAt: null,
            });
            await this.agendaStore.updateItem(found.data.item.id, { updatedAt: now });
            this.triggerEngine.cancel(triggerId);
            return record ? this.agendaStore.findItem(found.data.item.id) : null;
        });
    }

    async deleteTrigger(triggerId: number): Promise<AgendaRecord | null> {
        return this.agendaStore.runExclusive(async () => {
            const found = await this.agendaStore.findTrigger(triggerId);
            if (!found) return null;
            const now = Date.now();
            const record = await this.agendaStore.deleteTrigger(triggerId);
            await this.agendaStore.updateItem(found.data.item.id, { updatedAt: now });
            this.triggerEngine.cancel(triggerId);
            return record;
        });
    }

    async replaceTriggers(itemId: number, args: AgendaTriggerReplaceAllArgs): Promise<AgendaRecord | null> {
        return this.agendaStore.runExclusive(async () => {
            const item = await this.loadItem(itemId);
            if (!item) return null;
            const now = Date.now();
            const triggers = await this.createTriggersIfNeeded(item, {
                content: item.content,
                priority: item.priority,
                triggers:args.triggers,
                channelSessionId: args.channelSessionId,
            }, now);
            // 非空替换但全部无效时，不破坏现有调度；空数组是显式清空 active triggers。
            if (triggers.length > 0 || args.triggers.length === 0) {
                await this.disableItemTriggers(itemId, triggers.map(t => t.id));
                await this.agendaStore.updateItem(itemId, {
                    updatedAt: now,
                    dueAt: AgendaService.deriveDueAtFromSpecs(args.triggers, now),
                });
                for (const trigger of triggers) await this.triggerEngine.reload(trigger.id);
            }
            return this.agendaStore.findItem(itemId);
        });
    }

    async complete(id: number): Promise<AgendaRecord | null> {
        return this.terminate(id, AgendaStatus.Done);
    }

    async cancel(id: number): Promise<AgendaRecord | null> {
        return this.terminate(id, AgendaStatus.Cancelled);
    }

    /**
     * complete / cancel 的共用实现：整条置终态并停掉所有 trigger，仅 status 不同
     * （Done 额外写 doneAt，Cancelled 不写）。updateItem + disableItemTriggers 跨方法，
     * 必须包进 runExclusive，否则与并发的 addTrigger / 抽取交错时，可能出现
     * item 已置终态但并发新加的 trigger 漏掉 disable。item 不存在返回 null。
     */
    private async terminate(id: number, status: AgendaStatus.Done | AgendaStatus.Cancelled): Promise<AgendaRecord | null> {
        return this.agendaStore.runExclusive(async () => {
            const item = await this.loadItem(id);
            if (!item) return null;
            const now = Date.now();
            await this.agendaStore.updateItem(id, {
                status,
                updatedAt: now,
                ...(status === AgendaStatus.Done ? { doneAt: now } : {}),
            });
            await this.disableItemTriggers(id, []);
            return this.agendaStore.findItem(id);
        });
    }

    async reopen(id: number): Promise<AgendaRecord | null> {
        // cancel() 的逆操作（仅 item 层）：把 Cancelled/Done 的条目恢复为 Pending。
        // 触发器**不**在此连带复活——它们保持停用，由 reopenTrigger 逐条按需启用，
        // 避免把历史上被替换/已耗尽的 trigger 一并激活。已是 Pending 时幂等返回。
        return this.agendaStore.runExclusive(async () => {
            const record = await this.agendaStore.findItem(id);
            if (!record) return null;
            if (record.item.status === AgendaStatus.Pending) return record;  // 已是 Pending，幂等返回
            const now = Date.now();
            await this.agendaStore.updateItem(id, {
                status: AgendaStatus.Pending,
                doneAt: null,
                updatedAt: now,
            });
            return this.agendaStore.findItem(id);
        });
    }

    async reopenTrigger(triggerId: number): Promise<AgendaRecord | null> {
        // removeTrigger（软停用）的逆操作：重新启用单条 trigger 并重算 nextFireAt。
        // 交给 triggerEngine.reload 二次校验：所属 item 非 Pending 时 reload 会把它重新停用
        // （item 仍取消/完成时单独启用一条 trigger 无意义，需先 reopen item）；
        // absolute 若已过宽限窗口 reload 会 markMissed 停用，interval/cron 推进到下一个未来时刻。
        return this.agendaStore.runExclusive(async () => {
            const found = await this.agendaStore.findTrigger(triggerId);
            if (!found) return null;
            const trigger = found.trigger;
            const now = Date.now();
            let nextFireAt: number | null;
            try { nextFireAt = computeInitialNextFire(trigger.kind, trigger.expr, now); }
            catch { nextFireAt = null; }
            const fields: Partial<AgendaTrigger> = { enabled: true, nextFireAt };
            // 已耗尽（达 maxFires）的重新计数，否则启用后会立刻再触发一次就停。
            if (trigger.maxFires > 0 && trigger.fireCount >= trigger.maxFires) fields.fireCount = 0;
            await this.agendaStore.updateTrigger(triggerId, fields);
            await this.agendaStore.updateItem(found.data.item.id, { updatedAt: now });
            await this.triggerEngine.reload(triggerId);
            return this.agendaStore.findItem(found.data.item.id);
        });
    }

    async delete(id: number): Promise<AgendaRecord | null> {
        const data = await this.agendaStore.deleteItem(id);
        if (data) for (const trigger of data.triggers) this.triggerEngine.cancel(trigger.id);
        return data;
    }

    async formatForLLM(filter?: AgendaListFilter): Promise<string> {
        const records = await this.list(filter);
        return formatAgendaListXml(records);
    }

    // ── 写路径：入队 + 串行消费 ──

    extractFromConversation(messages: ChatMessage[], channelSessionId: number): void {
        if (!this.extractor || messages.length === 0) return;
        try {
            this.agendaStore.pushPendingMessages(channelSessionId, messages, Date.now());
        } catch (e: any) {
            this.logger?.warn(`Agenda push pending failed: ${formatError(e, true)}`);
            return;
        }
        void this.checkJobs();
    }

    listPending(limit?: number): PendingAgendaJobRow[] {
        return this.agendaStore.listPendingJobs(limit ?? DEFAULT_PENDING_JOB_LIMIT);
    }

    processPending(): void {
        void this.checkJobs();
    }

    /**
     * 串行消费 pending job 队列：isRunning 单标志 + 循环 popPendingJob → 处理 → 删行 / 标 failed。
     *
     * 互斥与漏单保证（参考 MemoryService.checkJobs）：
     * - 顶部 `if (isRunning) return` 同步短路重入（与下一行 isRunning=true 无 await 缝隙）；
     * - 任何 push 都是先同步 SQL INSERT 再 `void checkJobs()`；
     * - 自固定 refCount：drain 自己持一份引用，期间 caller release 不会触发 evict。
     */
    private async checkJobs(): Promise<void> {
        if (this.isRunning) return;
        this.isRunning = true;
        this.refCount++;
        try {
            while (true) {
                let next: PendingAgendaJobRow | null;
                try {
                    next = this.agendaStore.popPendingJob();
                } catch {
                    break;  // store 被关 → 退出 drain
                }
                if (!next) break;
                try {
                    const applied = await this.runPendingJob(next);
                    this.agendaStore.deletePendingJob(next.id);
                    this.logger?.info(`agenda pending ${next.type} #${next.id} done: ${applied} action(s) applied`);
                } catch (e: any) {
                    const errMsg = formatError(e).slice(0, ERROR_MESSAGE_MAX_LEN);
                    try { this.agendaStore.markPendingJobFailed(next.id, errMsg, Date.now()); } catch { /* store closed; swallow */ }
                    this.logger?.warn(`agenda pending ${next.type} #${next.id} failed: ${errMsg}`);
                }
            }
        } finally {
            this.isRunning = false;
            this.release();  // 配对开头 refCount++；归零自动 evict
        }
    }

    private async runPendingJob(job: PendingAgendaJobRow): Promise<number> {
        switch (job.type) {
            case AgendaPendingJobType.Extract:
                return this.runExtractJob(job.messages ?? [], job.channelSessionId);
        }
    }

    private async runExtractJob(messages: ChatMessage[], channelSessionId: number): Promise<number> {
        if (!this.extractor || messages.length === 0) return 0;
        // 只把 Pending 条目喂给 sync extractor：done/cancelled 是只读历史，sync 对它们没有可操作动作，
        // 暴露出去只会诱发误操作（复活已取消项、对已完成项重复 Complete）。打卡 routine 主体恒为 Pending，不受影响。
        const existing = await this.list({ status: AgendaStatus.Pending, limit: EXISTING_AGENDA_LIMIT });
        const actions = await this.extractor.extract(messages, existing);
        if (actions.length === 0) return 0;
        for (const action of actions) await this.applyAction(action, channelSessionId);
        return actions.length;
    }

    private async applyAction(action: AgendaAction, channelSessionId: number): Promise<void> {
        if (action.type === AgendaActionType.Create) {
            await this.create({ ...action.args, source: AgendaSource.Sync, channelSessionId });
        } else if (action.type === AgendaActionType.Update) {
            await this.update(action.id, action.patch);
        } else if (action.type === AgendaActionType.Complete) {
            await this.complete(action.id);
        } else if (action.type === AgendaActionType.TriggerAdd) {
            await this.addTrigger(action.itemId, { ...action.args, channelSessionId });
        } else if (action.type === AgendaActionType.TriggerUpdate) {
            await this.updateTrigger(action.triggerId, { ...action.patch, channelSessionId });
        } else if (action.type === AgendaActionType.TriggerRemove) {
            await this.removeTrigger(action.triggerId);
        } else if (action.type === AgendaActionType.TriggerReplaceAll) {
            await this.replaceTriggers(action.itemId, { ...action.args, channelSessionId });
        }
    }

    private async createTriggersIfNeeded(item: AgendaItem, args: AgendaCreateArgs, now: number): Promise<AgendaTrigger[]> {
        const triggers: AgendaTrigger[] = [];
        for (const spec of args.triggers ?? []) {
            const trigger = await this.createTrigger(item, args, spec, now);
            if (trigger) triggers.push(trigger);
        }
        return triggers;
    }

    private async createTrigger(item: AgendaItem, args: AgendaCreateArgs, spec: AgendaTriggerSpec, now: number): Promise<AgendaTrigger | null> {
        const schedule = this.buildTriggerScheduleFields(spec, now);
        if (!schedule) return null;
        return this.agendaStore.appendTrigger(item.id, {
            itemId: item.id,
            ...schedule,
            action: spec.action ?? AgendaTriggerAction.Notify,
            message: spec.message.trim(),
            // per-trigger 优先（admin 显式配置）；否则回退到 batch 级注入（tool / extractor 上下文会话）。
            channelSessionId: spec.channelSessionId ?? args.channelSessionId ?? 0,
            enabled: true,
            fireCount: 0,
            lastFiredAt: null,
            createdAt: now,
        });
    }

    private buildTriggerScheduleFields(spec: AgendaTriggerSpec, now: number): Pick<AgendaTrigger, "kind" | "expr" | "maxFires" | "nextFireAt"> | null {
        let kind: AgendaTriggerKind;
        let expr: string;

        if (spec.kind === AgendaTriggerKind.Absolute) {
            if (!spec.at) return null;
            kind = AgendaTriggerKind.Absolute;
            expr = new Date(TimeUtils.parseAt(spec.at)).toISOString();
        } else if (spec.kind === AgendaTriggerKind.Interval) {
            kind = AgendaTriggerKind.Interval;
            expr = String(relativeToMs(spec.every));
        } else if (spec.kind === AgendaTriggerKind.Cron) {
            const trimmed = spec.expr.trim();
            if (!trimmed) return null;
            kind = AgendaTriggerKind.Cron;
            expr = trimmed;
        } else {
            return null;
        }

        // Interval/Cron 的 startAt 覆盖默认首次触发时刻（之后按 every / cron 节奏推进）；Absolute 无此字段。
        const startTime = spec.kind !== AgendaTriggerKind.Absolute && spec.startAt
            ? TimeUtils.parseAt(spec.startAt) : null;
        const nextFireAt = startTime ?? computeInitialNextFire(kind, expr, now);
        const maxFires = spec.kind === AgendaTriggerKind.Absolute ? 1 : AgendaService.coerceCount(spec.count);
        return { kind, expr, maxFires, nextFireAt };
    }

    /** 把外部传入的 count 规范化到 trigger.maxFires：>0 → floor，其他 → 0（无限）。 */
    private static coerceCount(count: number | undefined): number {
        return count != null && count > 0 ? Math.floor(count) : 0;
    }

    private inferDueAt(args: AgendaCreateArgs, now: number): number | null {
        // 显式传入优先（主要给 Todo 用）
        if (args.dueAt) return TimeUtils.parseAt(args.dueAt);
        return AgendaService.deriveDueAtFromSpecs(args.triggers ?? [], now);
    }

    private mergeDueAt(current: number | null, next: number | null): number | null {
        if (current == null) return next;
        if (next == null) return current;
        return Math.max(current, next);
    }

    /**
     * 从 trigger spec 推导 dueAt：
     * - Absolute: trigger.at
     * - Interval + count > 0: startTime + (count-1) * everyMs（最后一次触发时刻）
     * - 其他（Cron / 无 count 的周期 / 无 trigger）: null
     */
    private static deriveDueAtFromSpecs(specs: AgendaTriggerSpec[] | undefined, now: number): number | null {
        const values = (specs ?? [])
            .map(spec => AgendaService.deriveDueAtFromSpec(spec, now))
            .filter((value): value is number => value != null);
        if (values.length === 0) return null;
        return Math.max(...values);
    }

    private static deriveDueAtFromSpec(spec: AgendaTriggerSpec | undefined, now: number): number | null {
        if (!spec) return null;
        if (spec.kind === AgendaTriggerKind.Absolute && spec.at) return TimeUtils.parseAt(spec.at);
        if (spec.kind === AgendaTriggerKind.Interval && spec.count != null && spec.count > 0) {
            const startTime = spec.startAt ? TimeUtils.parseAt(spec.startAt) : now + relativeToMs(spec.every);
            return startTime + (Math.floor(spec.count) - 1) * relativeToMs(spec.every);
        }
        return null;
    }

    private async findNearDuplicate(content: string, dueAt: number | null): Promise<AgendaRecord | null> {
        const records = await this.agendaStore.listItems();
        const normalized = this.normalize(content);
        // 倒序扫描全部 pending：agenda 量级有限（典型 <200），无需窗口；越新的越可能是真重复。
        for (let i = records.length - 1; i >= 0; i--) {
            const record = records[i];
            const row = record.item;
            if (row.status !== AgendaStatus.Pending) continue;
            if (this.normalize(row.content) !== normalized) continue;
            if (dueAt == null && row.dueAt == null) return record;
            if (dueAt != null && row.dueAt != null && Math.abs(dueAt - row.dueAt) < 2 * 60 * 1000) return record;
        }
        return null;
    }

    private normalize(value: string): string {
        return value.replace(/\s+/g, '').toLowerCase();
    }

    private async loadItem(id: number): Promise<AgendaItem | null> {
        const record = await this.agendaStore.findItem(id);
        return record?.item ?? null;
    }

    private static matchesFilter(record: AgendaRecord, filter?: AgendaListFilter): boolean {
        const status = filter?.status ?? AgendaStatus.Pending;
        const item = record.item;
        if (status !== 'all' && item.status !== status) return false;
        if (filter?.priority && item.priority !== filter.priority) return false;
        return true;
    }

    private static firstNextFire(record: AgendaRecord): number | null {
        const values = record.triggers
            .filter(t => t.enabled && t.nextFireAt)
            .map(t => t.nextFireAt as number)
            .sort((a, b) => a - b);
        return values[0] ?? null;
    }

    private async disableItemTriggers(itemId: number, exceptTriggerIds: number[]): Promise<void> {
        const ids = await this.agendaStore.updateActiveTriggersByItem(itemId, { enabled: false, nextFireAt: null }, exceptTriggerIds);
        for (const id of ids) this.triggerEngine.cancel(id);
    }
}
