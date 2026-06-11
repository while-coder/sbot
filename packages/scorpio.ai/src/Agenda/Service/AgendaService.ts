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
    type AgendaItemView,
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
        const isDerivedFromDueAt = !args.trigger && !!args.dueAt;
        const effectiveArgs = this.withDefaultDueAtTrigger(args);
        const trigger = await this.createTriggerIfNeeded(record.item, effectiveArgs, action, now, isDerivedFromDueAt);
        if (trigger) await this.triggerEngine.reload(trigger.id);
        const view = await this.getView(record.item.id) as AgendaItemView;
        return { item: view, created: true, existed: false };
    }

    async list(filter?: AgendaListFilter): Promise<AgendaItemView[]> {
        return AgendaService.buildList(await this.agendaStore.listItems(), filter);
    }

    static buildList(records: AgendaRecord[], filter?: AgendaListFilter): AgendaItemView[] {
        const views = records.map(record => AgendaService.buildView(record)).filter(view => AgendaService.matchesFilter(view, filter));
        views.sort((a, b) => {
            const an = AgendaService.firstNextFire(a) ?? a.dueAt ?? a.createdAt;
            const bn = AgendaService.firstNextFire(b) ?? b.dueAt ?? b.createdAt;
            if (a.status !== b.status) return a.status === AgendaStatus.Pending ? -1 : 1;
            return an - bn;
        });
        return views.slice(0, Math.max(1, filter?.limit ?? 50));
    }

    async update(id: number, patch: AgendaUpdatePatch): Promise<AgendaItemView | null> {
        const item = await this.requireOwnedItem(id);
        if (!item) return null;
        const now = Date.now();
        const fields: Partial<AgendaItem> = { updatedAt: now };
        if (patch.content != null && patch.content.trim()) fields.content = patch.content.trim();
        if (patch.category != null) fields.category = patch.category;
        if (patch.priority != null) fields.priority = patch.priority;
        if (patch.completionMode != null) fields.completionMode = patch.completionMode;
        if (patch.dueAt !== undefined) {
            fields.dueAt = patch.dueAt === null ? null : TimeUtils.parseAt(patch.dueAt);
        } else if (this.hasSchedulePatch(patch)) {
            // 调度变更但未显式指定 dueAt：依据新 trigger 推导，与 create 保持一致。
            fields.dueAt = AgendaService.deriveDueAtFromSpec(patch.trigger, now);
        }

        const data = await this.agendaStore.updateItem(id, fields);
        const updatedItem = data?.item;
        if (!updatedItem) return null;

        if (this.hasSchedulePatch(patch)) {
            const category = updatedItem.category;
            const action = patch.action ?? AgendaTriggerAction.Notify;
            const trigger = await this.createTriggerIfNeeded(updatedItem, {
                content: updatedItem.content,
                category,
                priority: updatedItem.priority,
                completionMode: updatedItem.completionMode,
                trigger: patch.trigger,
                timezone: patch.timezone ?? undefined,
                action,
                message: patch.message ?? undefined,
            }, action, now);
            // 仅在新触发器创建成功时替换旧触发器；否则视为无效输入，不破坏现有调度
            if (trigger) {
                await this.disableItemTriggers(id, trigger.id);
                await this.triggerEngine.reload(trigger.id);
            }
        } else if (patch.dueAt !== undefined && fields.dueAt !== item.dueAt) {
            // dueAt 变了但用户没传 trigger：同步派生 trigger（关掉旧的 derived，按新 dueAt 重建）
            await this.syncDerivedTrigger(id, fields.dueAt ?? null, patch, now);
        } else if (this.hasTriggerFieldPatch(patch)) {
            const triggerFields: Partial<AgendaTrigger> = {};
            if (patch.timezone !== undefined) triggerFields.timezone = patch.timezone;
            if (patch.action !== undefined) triggerFields.action = patch.action;
            if (patch.message !== undefined) triggerFields.message = patch.message?.trim() || null;
            const record = await this.agendaStore.findItem(id);
            const activeTriggers = record?.triggers.filter(t => t.enabled) ?? [];
            for (const trigger of activeTriggers) await this.agendaStore.updateTrigger(trigger.id, triggerFields);
            await this.triggerEngine.reloadItem(id);
        }
        return this.getView(id);
    }

    /**
     * dueAt 变化但用户没传 trigger 时调用：关掉所有 derived=true 的 trigger，
     * 若新 dueAt 不为空，再派生一条新的 Absolute trigger。
     * 用户显式建的 trigger（derived=false）不被触碰。
     */
    private async syncDerivedTrigger(itemId: number, newDueAt: number | null, patch: AgendaUpdatePatch, now: number): Promise<void> {
        const record = await this.agendaStore.findItem(itemId);
        if (!record) return;

        for (const t of record.triggers) {
            if (!t.derived || !t.enabled) continue;
            await this.agendaStore.updateTrigger(t.id, { enabled: false, nextFireAt: null });
            this.triggerEngine.cancel(t.id);
        }

        if (newDueAt != null) {
            const action = patch.action ?? AgendaTriggerAction.Notify;
            const trigger = await this.createTriggerIfNeeded(record.item, {
                content: record.item.content,
                trigger: { kind: AgendaTriggerKind.Absolute, at: new Date(newDueAt).toISOString() },
                timezone: patch.timezone ?? undefined,
                action,
                message: patch.message ?? undefined,
            }, action, now, true);
            if (trigger) await this.triggerEngine.reload(trigger.id);
        }
    }

    async complete(id: number): Promise<AgendaItemView | null> {
        const item = await this.requireOwnedItem(id);
        if (!item) return null;
        const now = Date.now();
        // Occurrence 模式：只消费一次 pending occurrence，不影响 routine 主体。
        // 没有 pending occurrence 时视为 no-op；用户若要终止整条 routine，应使用 cancel。
        if (item.completionMode === AgendaCompletionMode.Occurrence) {
            const occ = await this.firstPendingOccurrence(id);
            if (occ) {
                await this.agendaStore.updateOccurrence(occ.id, {
                    status: AgendaOccurrenceStatus.Done,
                    doneAt: now,
                });
            }
            return this.getView(id);
        }
        await this.agendaStore.updateItem(id, {
            status: AgendaStatus.Done,
            doneAt: now,
            updatedAt: now,
        });
        await this.disableItemTriggers(id);
        return this.getView(id);
    }

    async cancel(id: number): Promise<AgendaItemView | null> {
        const item = await this.requireOwnedItem(id);
        if (!item) return null;
        const now = Date.now();
        await this.agendaStore.updateItem(id, {
            status: AgendaStatus.Cancelled,
            updatedAt: now,
        });
        await this.disableItemTriggers(id);
        return this.getView(id);
    }

    async skipNext(id: number): Promise<AgendaItemView | null> {
        const item = await this.requireOwnedItem(id);
        if (!item) return null;
        const record = await this.agendaStore.findItem(id);
        const trigger = record?.triggers
            .filter(t => t.enabled && t.nextFireAt)
            .sort((a, b) => (a.nextFireAt ?? 0) - (b.nextFireAt ?? 0))[0];
        if (!trigger) return this.getView(id);
        if (trigger.kind === AgendaTriggerKind.Absolute) {
            await this.agendaStore.updateTrigger(trigger.id, {
                enabled: false,
                nextFireAt: null,
                skipNextFireAt: trigger.nextFireAt,
                skipFireCount: trigger.fireCount ?? 0,
            });
            this.triggerEngine.cancel(trigger.id);
        } else {
            await this.agendaStore.updateTrigger(trigger.id, {
                skipNextFireAt: trigger.nextFireAt,
                skipFireCount: trigger.fireCount ?? 0,
            });
            await this.triggerEngine.reload(trigger.id);
        }
        return this.getView(id);
    }

    async delete(id: number): Promise<AgendaRecord | null> {
        const data = await this.agendaStore.deleteItem(id);
        if (data) for (const trigger of data.triggers) this.triggerEngine.cancel(trigger.id);
        return data;
    }

    async formatForLLM(filter?: AgendaListFilter): Promise<string> {
        const items = await this.list(filter);
        if (items.length === 0) return "No agenda items.";
        const lines = items.map(item => {
            const next = AgendaService.firstNextFire(item);
            const due = item.dueAt ? ` due=${TimeUtils.formatWhen(item.dueAt)}` : '';
            const nextText = next ? ` next=${TimeUtils.formatWhen(next)}` : '';
            const occ = item.occurrences?.filter(o => o.status === AgendaOccurrenceStatus.Pending).length ?? 0;
            const occText = occ > 0 ? ` pending_occurrences=${occ}` : '';
            return `#${item.id} [${item.status}/${item.category}/${item.priority}/${item.completionMode}] ${item.content}${due}${nextText}${occText}`;
        });
        return `${items.length} agenda item(s):\n\n${lines.join('\n')}`;
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
            await this.complete(action.id);
        } else if (action.type === AgendaActionType.Cancel) {
            await this.cancel(action.id);
        }
    }

    private async createTriggerIfNeeded(item: AgendaItem, args: AgendaCreateArgs, action: AgendaTriggerAction, now: number, derived = false): Promise<AgendaTrigger | null> {
        const spec = args.trigger;
        if (!spec) return null;

        let kind: AgendaTriggerKind;
        let expr: string;
        let nextFireAt: number | null;
        let maxFires = 1;

        if (spec.kind === AgendaTriggerKind.Absolute) {
            if (!spec.at) return null;
            kind = AgendaTriggerKind.Absolute;
            expr = new Date(TimeUtils.parseAt(spec.at)).toISOString();
            nextFireAt = computeInitialNextFire(kind, expr, now, args.timezone);
        } else if (spec.kind === AgendaTriggerKind.Interval) {
            kind = AgendaTriggerKind.Interval;
            expr = String(relativeToMs(spec.every));
            // startAt 覆盖默认的 now+interval；首次触发由 startAt 控制，之后按 interval 累加。
            const startTime = spec.startAt ? TimeUtils.parseAt(spec.startAt) : null;
            nextFireAt = startTime ?? computeInitialNextFire(kind, expr, now, args.timezone);
            maxFires = AgendaService.coerceCount(spec.count);
        } else if (spec.kind === AgendaTriggerKind.Cron) {
            const trimmed = spec.expr.trim();
            if (!trimmed) return null;
            kind = AgendaTriggerKind.Cron;
            expr = trimmed;
            // cron + startAt：首次按 startAt（不一定是 cron 命中时刻），之后由 advanceAfterFire 走 cron 节奏。
            const startTime = spec.startAt ? TimeUtils.parseAt(spec.startAt) : null;
            nextFireAt = startTime ?? computeInitialNextFire(kind, expr, now, args.timezone);
            maxFires = AgendaService.coerceCount(spec.count);
        } else {
            return null;
        }

        return this.agendaStore.appendTrigger(item.id, {
            itemId: item.id,
            kind,
            expr,
            timezone: args.timezone ?? null,
            action,
            message: args.message?.trim() || null,
            channelHint: this.channelSessionId,
            enabled: true,
            fireCount: 0,
            maxFires,
            lastFiredAt: null,
            nextFireAt,
            skipNextFireAt: null,
            skipFireCount: null,
            derived,
            createdAt: now,
        });
    }

    /** 把外部传入的 count 规范化到 trigger.maxFires：>0 → floor，其他 → 0（无限）。 */
    private static coerceCount(count: number | undefined): number {
        return count != null && count > 0 ? Math.floor(count) : 0;
    }

    private hasSchedulePatch(patch: AgendaUpdatePatch): boolean {
        return patch.trigger !== undefined;
    }

    private hasTriggerFieldPatch(patch: AgendaUpdatePatch): boolean {
        return patch.timezone !== undefined || patch.action !== undefined || patch.message !== undefined;
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

    private async findNearDuplicate(content: string, dueAt: number | null): Promise<AgendaItemView | null> {
        const records = await this.agendaStore.listItems();
        const normalized = this.normalize(content);
        for (const record of records.slice(-30).reverse()) {
            const row = record.item;
            if (row.status !== AgendaStatus.Pending) continue;
            if (this.normalize(row.content) !== normalized) continue;
            if (dueAt == null && row.dueAt == null) return AgendaService.buildView(record);
            if (dueAt != null && row.dueAt != null && Math.abs(dueAt - row.dueAt) < 2 * 60 * 1000) return AgendaService.buildView(record);
        }
        return null;
    }

    private normalize(value: string): string {
        return value.replace(/\s+/g, '').toLowerCase();
    }

    private async requireOwnedItem(id: number): Promise<AgendaItem | null> {
        const record = await this.agendaStore.findItem(id);
        return record?.item ?? null;
    }

    private async getView(id: number): Promise<AgendaItemView | null> {
        const record = await this.agendaStore.findItem(id);
        return record ? AgendaService.buildView(record) : null;
    }

    static buildView(record: AgendaRecord): AgendaItemView {
        return {
            ...record.item,
            category: AgendaService.normalizeLegacyCategory(record),
            triggers: record.triggers.map(t => ({
                ...t,
                enabled: Boolean(t.enabled),
                action: AgendaService.normalizeLegacyAction(t.action),
            })),
            occurrences: record.occurrences,
        };
    }

    /**
     * 兼容旧库：曾经存在 category='automation' 的行，新枚举里不再有此值。
     * 按 trigger/dueAt 推断为合理的形态分类，避免上层取到 enum 之外的值。
     */
    private static normalizeLegacyCategory(record: AgendaRecord): AgendaCategory {
        const raw = record.item.category;
        if ((raw as string) !== 'automation') return raw;
        if (record.triggers.some(t => t.kind === AgendaTriggerKind.Interval || t.kind === AgendaTriggerKind.Cron)) {
            return AgendaCategory.Routine;
        }
        if (record.item.dueAt != null) return AgendaCategory.Reminder;
        return AgendaCategory.Todo;
    }

    /**
     * 兼容旧库：trigger.action='send' 在新枚举里被合并到 Notify（语义已等同：发原文 + 不让 AI 处理）。
     */
    private static normalizeLegacyAction(raw: AgendaTriggerAction): AgendaTriggerAction {
        if ((raw as string) === 'send') return AgendaTriggerAction.Notify;
        return raw;
    }

    private static matchesFilter(item: AgendaItemView, filter?: AgendaListFilter): boolean {
        const status = filter?.status ?? AgendaStatus.Pending;
        if (status !== 'all' && item.status !== status) return false;
        if (filter?.category && item.category !== filter.category) return false;
        if (filter?.priority && item.priority !== filter.priority) return false;
        const view = filter?.view ?? AgendaListView.Todo;
        if (view === AgendaListView.All) return true;
        if (view === AgendaListView.Routine) return item.category === AgendaCategory.Routine;
        // Automation view 由 trigger.action 决定：含任何非 Notify 的 trigger 即视为"自动化任务"。
        if (view === AgendaListView.Automation) return AgendaService.isAutomation(item);
        if (view === AgendaListView.Upcoming) return item.triggers.some(t => t.enabled && t.nextFireAt);
        // 默认 Todo view：排除"自动化"类（口径同 Automation view），与历史行为一致。
        return !AgendaService.isAutomation(item);
    }

    private static isAutomation(item: AgendaItemView): boolean {
        return item.triggers.some(t => t.action !== AgendaTriggerAction.Notify);
    }

    private static firstNextFire(item: AgendaItemView): number | null {
        const values = item.triggers
            .filter(t => t.enabled && t.nextFireAt)
            .map(t => t.nextFireAt as number)
            .sort((a, b) => a - b);
        return values[0] ?? null;
    }

    private async firstPendingOccurrence(itemId: number): Promise<AgendaOccurrence | null> {
        const record = await this.agendaStore.findItem(itemId);
        return record?.occurrences
            .filter(o => o.status === AgendaOccurrenceStatus.Pending)
            .sort((a, b) => a.scheduledAt - b.scheduledAt)[0] ?? null;
    }

    private async disableItemTriggers(itemId: number, exceptTriggerId?: number): Promise<void> {
        const ids = await this.agendaStore.updateActiveTriggersByItem(itemId, { enabled: false, nextFireAt: null }, exceptTriggerId);
        for (const id of ids) this.triggerEngine.cancel(id);
    }
}
