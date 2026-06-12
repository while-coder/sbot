import { inject } from "scorpio.di";
import { T_AgendaChannelSessionId, T_AgendaToolDescs } from "../../Core";
import { ILoggerService, type ILogger } from "../../Logger";
import {
    AgendaCategory,
    AgendaCompletionMode,
    AgendaListView,
    AgendaOccurrenceStatus,
    AgendaPriority,
    AgendaSource,
    AgendaStatus,
    AgendaTriggerAction,
    AgendaTriggerKind,
    type AgendaCreateArgs,
    type AgendaCreateResult,
    type AgendaItem,
    type AgendaListFilter,
    type AgendaOccurrence,
    type AgendaRecord,
    type AgendaTrigger,
    type AgendaTriggerSpec,
    type AgendaUpdatePatch,
} from "../types";
import {
    type AgendaAction,
    AgendaActionType,
    IAgendaExtractor,
} from "../Extractor/IAgendaExtractor";
import { IAgendaTriggerEngine } from "../TriggerEngine/IAgendaTriggerEngine";
import { IAgendaStore } from "../Storage/IAgendaStore";
import { TimeUtils } from "../../Utils/TimeUtils";
import { computeInitialNextFire, relativeToMs } from "../time";
import { type AgendaToolDescs, IAgendaService } from "./IAgendaService";

export class AgendaService implements IAgendaService {
    private readonly logger?: ILogger;

    constructor(
        @inject(T_AgendaChannelSessionId) private channelSessionId: number,
        @inject(T_AgendaToolDescs) private toolDescs: AgendaToolDescs,
        @inject(IAgendaStore) private agendaStore: IAgendaStore,
        @inject(IAgendaTriggerEngine) private triggerEngine: IAgendaTriggerEngine,
        @inject(IAgendaExtractor, { optional: true }) private extractor?: IAgendaExtractor,
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
    ) {
        this.logger = loggerService?.getLogger("AgendaService.ts");
    }

    getToolDescs(): AgendaToolDescs {
        return this.toolDescs;
    }

    async create(args: AgendaCreateArgs): Promise<AgendaCreateResult> {
        const content = args.content?.trim();
        if (!content) throw new Error("content is required");
        const now = Date.now();
        const category = args.category ?? this.inferCategory(args);
        const completionMode = args.completionMode ?? this.inferCompletionMode(category);
        const action = args.action ?? AgendaTriggerAction.Notify;
        const dueAt = this.inferDueAt(args, now);

        const existing = await this.findNearDuplicate(content, dueAt);
        if (existing) return { item: existing, created: false, existed: true };

        const record = await this.agendaStore.createItem({
            content,
            status: AgendaStatus.Pending,
            priority: args.priority ?? AgendaPriority.Normal,
            category,
            completionMode,
            dueAt,
            source: args.source ?? AgendaSource.Tool,
            createdAt: now,
            updatedAt: now,
            doneAt: null,
        });

        // 显式 dueAt 但没传 trigger（典型场景：纯 Todo 加截止）→ 派生一个 Absolute trigger，
        // 让 dueAt 时刻自动发一次"已到截止"提醒；否则 dueAt 过期后系统不会有任何主动行为。
        const effectiveArgs = this.withDefaultDueAtTrigger(args);
        const trigger = await this.createTriggerIfNeeded(record.item, effectiveArgs, action, now);
        if (trigger) await this.triggerEngine.reload(trigger.id);
        const fresh = await this.agendaStore.findItem(record.item.id);
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
        return filtered.slice(0, Math.max(1, filter?.limit ?? 50));
    }

    async update(id: number, patch: AgendaUpdatePatch): Promise<AgendaRecord | null> {
        const item = await this.loadItem(id);
        if (!item) return null;
        const now = Date.now();
        const fields: Partial<AgendaItem> = { updatedAt: now };
        if (patch.content != null && patch.content.trim()) fields.content = patch.content.trim();
        if (patch.category != null) fields.category = patch.category;
        if (patch.priority != null) fields.priority = patch.priority;
        if (patch.completionMode != null) fields.completionMode = patch.completionMode;
        if (patch.dueAt !== undefined) {
            fields.dueAt = patch.dueAt === null ? null : TimeUtils.parseAt(patch.dueAt);
        } else if (patch.trigger !== undefined) {
            // 调度变更但未显式指定 dueAt：依据新 trigger 推导，与 create 保持一致。
            fields.dueAt = AgendaService.deriveDueAtFromSpec(patch.trigger, now);
        }

        const data = await this.agendaStore.updateItem(id, fields);
        const updatedItem = data?.item;
        if (!updatedItem) return null;

        if (patch.trigger !== undefined) {
            const category = updatedItem.category;
            const action = patch.action ?? AgendaTriggerAction.Notify;
            const trigger = await this.createTriggerIfNeeded(updatedItem, {
                content: updatedItem.content,
                category,
                priority: updatedItem.priority,
                completionMode: updatedItem.completionMode,
                trigger: patch.trigger,
                action,
                message: patch.message ?? undefined,
            }, action, now);
            // 仅在新触发器创建成功时替换旧触发器；否则视为无效输入，不破坏现有调度
            if (trigger) {
                await this.disableItemTriggers(id, trigger.id);
                await this.triggerEngine.reload(trigger.id);
            }
        } else if (this.hasTriggerFieldPatch(patch)) {
            const triggerFields: Partial<AgendaTrigger> = {};
            if (patch.action !== undefined) triggerFields.action = patch.action;
            if (patch.message !== undefined) triggerFields.message = patch.message?.trim() || null;
            const record = await this.agendaStore.findItem(id);
            const activeTriggers = record?.triggers.filter(t => t.enabled) ?? [];
            for (const trigger of activeTriggers) await this.agendaStore.updateTrigger(trigger.id, triggerFields);
            await this.triggerEngine.reloadItem(id);
        }
        // 注意：仅改 dueAt 不会联动现有 trigger。如需调度同步，调用方应在同一次 update 里显式传 trigger。
        return this.agendaStore.findItem(id);
    }

    async complete(id: number, at?: string): Promise<AgendaRecord | null> {
        const item = await this.loadItem(id);
        if (!item) return null;
        const now = Date.now();
        // Occurrence 模式：只消费一条 occurrence，不影响 routine 主体。
        // - 不传 at: 关最早的 pending（普通打卡语义；补办场景必须显式传 at）
        // - 传 at: 在 pending + missed 中找 scheduledAt 最接近 at 的（支持补办过去 missed）
        // 用户若要终止整条 routine，应使用 cancel。
        if (item.completionMode === AgendaCompletionMode.Occurrence) {
            const target = await this.pickOccurrenceForComplete(id, at);
            if (target) {
                await this.agendaStore.updateOccurrence(target.id, {
                    status: AgendaOccurrenceStatus.Done,
                    doneAt: now,
                });
            } else {
                this.logger?.info(`Agenda complete(#${id}${at ? `, at=${at}` : ''}): no matching occurrence`);
            }
            return this.agendaStore.findItem(id);
        }
        await this.agendaStore.updateItem(id, {
            status: AgendaStatus.Done,
            doneAt: now,
            updatedAt: now,
        });
        await this.disableItemTriggers(id);
        return this.agendaStore.findItem(id);
    }

    private async pickOccurrenceForComplete(
        itemId: number,
        at: string | undefined,
    ): Promise<AgendaOccurrence | null> {
        const record = await this.agendaStore.findItem(itemId);
        if (!record) return null;

        if (at) {
            // 显式补办/精确指定：在 pending + missed 中找最接近 at 的
            const candidates = record.occurrences.filter(o =>
                o.status === AgendaOccurrenceStatus.Pending || o.status === AgendaOccurrenceStatus.Missed,
            );
            if (candidates.length === 0) return null;
            const target = TimeUtils.parseAt(at);
            return candidates.reduce((best, cur) =>
                Math.abs(cur.scheduledAt - target) < Math.abs(best.scheduledAt - target) ? cur : best,
            );
        }
        // 普通打卡：仅看 pending，关最早的
        const pendings = record.occurrences.filter(o => o.status === AgendaOccurrenceStatus.Pending);
        if (pendings.length === 0) return null;
        return pendings.reduce((earliest, cur) => cur.scheduledAt < earliest.scheduledAt ? cur : earliest);
    }

    async cancel(id: number): Promise<AgendaRecord | null> {
        const item = await this.loadItem(id);
        if (!item) return null;
        const now = Date.now();
        await this.agendaStore.updateItem(id, {
            status: AgendaStatus.Cancelled,
            updatedAt: now,
        });
        await this.disableItemTriggers(id);
        return this.agendaStore.findItem(id);
    }

    async delete(id: number): Promise<AgendaRecord | null> {
        const data = await this.agendaStore.deleteItem(id);
        if (data) for (const trigger of data.triggers) this.triggerEngine.cancel(trigger.id);
        return data;
    }

    async formatForLLM(filter?: AgendaListFilter): Promise<string> {
        const records = await this.list(filter);
        if (records.length === 0) return "No agenda items.";
        const lines = records.map(record => AgendaService.formatRecord(record));
        return `${records.length} agenda item(s):\n\n${lines.join('\n')}`;
    }

    /** 每个 occurrence 状态分组里最多列出多少条（取最近的 = scheduledAt 降序）。 */
    private static readonly OCC_GROUP_LIMIT = 10;

    /** YYYY-MM-DDTHH:mm，UTC。LLM 看到 ISO 能精确判断"哪天/哪小时"。 */
    private static fmtIso(ts: number): string {
        return new Date(ts).toISOString().slice(0, 16);
    }

    private static formatRecord(record: AgendaRecord): string {
        const item = record.item;
        const next = AgendaService.firstNextFire(record);
        const due = item.dueAt ? ` due=${AgendaService.fmtIso(item.dueAt)}` : '';
        const nextText = next ? ` next=${AgendaService.fmtIso(next)}` : '';
        const head = `#${item.id} [${item.status}/${item.category}/${item.priority}/${item.completionMode}]${due}${nextText} ${item.content}`;
        if (item.completionMode !== AgendaCompletionMode.Occurrence || record.occurrences.length === 0) return head;
        return `${head}\n${AgendaService.formatOccurrences(record.occurrences)}`;
    }

    /**
     * 按 status 分组列出 occurrence 时间，例：
     *   occurrences: done=3 missed=2 pending=1
     *     pending: 2026-06-12T14:00
     *     missed:  2026-06-12T12:00, 2026-06-12T13:00
     *     done:    2026-06-12T09:00, 2026-06-12T10:00, 2026-06-12T11:00
     * 每组最多列 OCC_GROUP_LIMIT 条最近的（按 scheduledAt 升序输出便于阅读），
     * 更早的报 "… N more earlier"。LLM 用这个回答"哪几个时刻没做"。
     */
    private static formatOccurrences(occurrences: AgendaOccurrence[]): string {
        const groups: Record<AgendaOccurrenceStatus, AgendaOccurrence[]> = {
            [AgendaOccurrenceStatus.Pending]:   [],
            [AgendaOccurrenceStatus.Missed]:    [],
            [AgendaOccurrenceStatus.Done]:      [],
            [AgendaOccurrenceStatus.Cancelled]: [],
        };
        for (const occ of occurrences) {
            const bucket = groups[occ.status];
            if (bucket) bucket.push(occ);
        }
        const counts = Object.entries(groups)
            .filter(([, arr]) => arr.length > 0)
            .map(([k, arr]) => `${k}=${arr.length}`)
            .join(' ');

        const lines: string[] = [`  occurrences: ${counts}`];
        const order: AgendaOccurrenceStatus[] = [
            AgendaOccurrenceStatus.Pending,
            AgendaOccurrenceStatus.Missed,
            AgendaOccurrenceStatus.Done,
            AgendaOccurrenceStatus.Cancelled,
        ];
        for (const status of order) {
            const arr = groups[status];
            if (arr.length === 0) continue;
            const sortedDesc = [...arr].sort((a, b) => b.scheduledAt - a.scheduledAt);
            const recent = sortedDesc.slice(0, AgendaService.OCC_GROUP_LIMIT);
            const omitted = sortedDesc.length - recent.length;
            const times = recent
                .slice()
                .reverse()
                .map(o => AgendaService.fmtIso(o.scheduledAt))
                .join(', ');
            const tail = omitted > 0 ? `, … ${omitted} more earlier` : '';
            lines.push(`    ${status}: ${times}${tail}`);
        }
        return lines.join('\n');
    }

    async extractFromConversation(userMessage: string, assistantMessages?: string[]): Promise<void> {
        if (!this.extractor) return;
        try {
            const existing = await this.list({ status: 'all', view: AgendaListView.All, limit: 80 });
            const actions = await this.extractor.extract(userMessage, assistantMessages ?? [], existing);
            if (actions.length === 0) return;
            for (const action of actions) await this.applyAction(action);
        } catch (e: any) {
            this.logger?.warn(`Agenda sync failed: ${e.message}`);
        }
    }

    private async applyAction(action: AgendaAction): Promise<void> {
        if (action.type === AgendaActionType.Create) {
            await this.create({ ...action.args, source: AgendaSource.Sync });
        } else if (action.type === AgendaActionType.Update) {
            await this.update(action.id, action.patch);
        } else if (action.type === AgendaActionType.Complete) {
            await this.complete(action.id, action.at);
        } else if (action.type === AgendaActionType.Cancel) {
            await this.cancel(action.id);
        }
    }

    private async createTriggerIfNeeded(item: AgendaItem, args: AgendaCreateArgs, action: AgendaTriggerAction, now: number): Promise<AgendaTrigger | null> {
        const spec = args.trigger;
        if (!spec) return null;

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

        return this.agendaStore.appendTrigger(item.id, {
            itemId: item.id,
            kind,
            expr,
            action,
            message: args.message?.trim() || null,
            channelHint: this.channelSessionId,
            enabled: true,
            fireCount: 0,
            maxFires,
            lastFiredAt: null,
            nextFireAt,
            createdAt: now,
        });
    }

    /** 把外部传入的 count 规范化到 trigger.maxFires：>0 → floor，其他 → 0（无限）。 */
    private static coerceCount(count: number | undefined): number {
        return count != null && count > 0 ? Math.floor(count) : 0;
    }

    private hasTriggerFieldPatch(patch: AgendaUpdatePatch): boolean {
        return patch.action !== undefined || patch.message !== undefined;
    }

    private inferCategory(args: AgendaCreateArgs): AgendaCategory {
        // category 只表达"时间形态"。"是否 AI 处理"由 args.action 独立承担。
        const kind = args.trigger?.kind;
        if (kind === AgendaTriggerKind.Interval || kind === AgendaTriggerKind.Cron) return AgendaCategory.Routine;
        if (kind === AgendaTriggerKind.Absolute) return AgendaCategory.Reminder;
        return AgendaCategory.Todo;
    }

    private inferCompletionMode(category: AgendaCategory): AgendaCompletionMode {
        return category === AgendaCategory.Todo ? AgendaCompletionMode.Item : AgendaCompletionMode.None;
    }

    /**
     * 用户显式传 dueAt 但没传 trigger 时，派生一个默认 Absolute trigger（at=dueAt）。
     * 让 dueAt 时刻自动发一次"已到截止"提醒。trigger.message 留空，由 buildMessage 回退到 content。
     * 不影响 inferCategory（仍是 Todo）和 completionMode（Item，由用户 complete）。
     * 过去时刻的 dueAt 由引擎按 markMissed 处理，不会立刻误触发。
     */
    private withDefaultDueAtTrigger(args: AgendaCreateArgs): AgendaCreateArgs {
        if (args.trigger || !args.dueAt) return args;
        return {
            ...args,
            trigger: { kind: AgendaTriggerKind.Absolute, at: args.dueAt },
        };
    }

    private inferDueAt(args: AgendaCreateArgs, now: number): number | null {
        // 显式传入优先（主要给 Todo 用）
        if (args.dueAt) return TimeUtils.parseAt(args.dueAt);
        return AgendaService.deriveDueAtFromSpec(args.trigger, now);
    }

    /**
     * 从 trigger spec 推导 dueAt：
     * - Absolute: trigger.at
     * - Interval + count > 0: startTime + (count-1) * everyMs（最后一次触发时刻）
     * - 其他（Cron / 无 count 的周期 / 无 trigger）: null
     */
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
        for (const record of records.slice(-30).reverse()) {
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
        if (filter?.category && item.category !== filter.category) return false;
        if (filter?.priority && item.priority !== filter.priority) return false;
        const view = filter?.view ?? AgendaListView.Todo;
        if (view === AgendaListView.All) return true;
        if (view === AgendaListView.Routine) return item.category === AgendaCategory.Routine;
        // Automation view 由 trigger.action 决定：含任何非 Notify 的 trigger 即视为"自动化任务"。
        if (view === AgendaListView.Automation) return AgendaService.isAutomation(record);
        if (view === AgendaListView.Upcoming) return record.triggers.some(t => t.enabled && t.nextFireAt);
        // 默认 Todo view：排除"自动化"类（口径同 Automation view），与历史行为一致。
        return !AgendaService.isAutomation(record);
    }

    private static isAutomation(record: AgendaRecord): boolean {
        return record.triggers.some(t => t.action !== AgendaTriggerAction.Notify);
    }

    private static firstNextFire(record: AgendaRecord): number | null {
        const values = record.triggers
            .filter(t => t.enabled && t.nextFireAt)
            .map(t => t.nextFireAt as number)
            .sort((a, b) => a - b);
        return values[0] ?? null;
    }

    private async disableItemTriggers(itemId: number, exceptTriggerId?: number): Promise<void> {
        const ids = await this.agendaStore.updateActiveTriggersByItem(itemId, { enabled: false, nextFireAt: null }, exceptTriggerId);
        for (const id of ids) this.triggerEngine.cancel(id);
    }
}
