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
        const action = args.action ?? (category === AgendaCategory.Automation ? AgendaTriggerAction.Invoke : AgendaTriggerAction.Notify);
        const dueAt = this.inferDueAt(args);

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

        const trigger = await this.createTriggerIfNeeded(record.item, args, action, now);
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
            // 调度变更但未显式指定 dueAt：与 create 保持一致，依据新调度推导 dueAt。
            // at/after → 触发时刻；every/cron → null。共用同一个 now 以与下方 createTriggerIfNeeded 对齐。
            if (patch.at) fields.dueAt = TimeUtils.parseAt(patch.at);
            else if (patch.after) fields.dueAt = now + relativeToMs(patch.after);
            else fields.dueAt = null;
        }

        const data = await this.agendaStore.updateItem(id, fields);
        const updatedItem = data?.item;
        if (!updatedItem) return null;

        if (this.hasSchedulePatch(patch)) {
            const category = updatedItem.category;
            const action = patch.action ?? (category === AgendaCategory.Automation ? AgendaTriggerAction.Invoke : AgendaTriggerAction.Notify);
            const trigger = await this.createTriggerIfNeeded(updatedItem, {
                content: updatedItem.content,
                category,
                priority: updatedItem.priority,
                completionMode: updatedItem.completionMode,
                at: patch.at,
                after: patch.after,
                every: patch.every,
                cron: patch.cron,
                startAt: patch.startAt,
                startAfter: patch.startAfter,
                count: patch.count,
                timezone: patch.timezone ?? undefined,
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

    private async createTriggerIfNeeded(item: AgendaItem, args: AgendaCreateArgs, action: AgendaTriggerAction, now: number): Promise<AgendaTrigger | null> {
        let kind: AgendaTriggerKind | null = null;
        let expr = '';
        let nextFireAt: number | null = null;
        let maxFires = 1;

        const startTime = this.computeStartTime(args, now);
        const count = args.count != null && args.count > 0 ? Math.floor(args.count) : 0;

        if (args.at) {
            kind = AgendaTriggerKind.Absolute;
            expr = new Date(TimeUtils.parseAt(args.at)).toISOString();
            nextFireAt = computeInitialNextFire(kind, expr, now, args.timezone);
        } else if (args.after) {
            kind = AgendaTriggerKind.Absolute;
            expr = new Date(now + relativeToMs(args.after)).toISOString();
            nextFireAt = computeInitialNextFire(kind, expr, now, args.timezone);
        } else if (args.every) {
            kind = AgendaTriggerKind.Interval;
            expr = String(relativeToMs(args.every));
            // startTime 覆盖默认的 now+interval；首次触发由 startTime 控制，之后按 interval 累加。
            nextFireAt = startTime ?? computeInitialNextFire(kind, expr, now, args.timezone);
            maxFires = count;
        } else if (args.cron?.trim()) {
            kind = AgendaTriggerKind.Cron;
            expr = args.cron.trim();
            // cron + startTime：首次按 startTime（不一定是 cron 命中时刻），之后由 advanceAfterFire 走 cron 节奏。
            nextFireAt = startTime ?? computeInitialNextFire(kind, expr, now, args.timezone);
            maxFires = count;
        }
        if (!kind) return null;

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
            createdAt: now,
        });
    }

    private computeStartTime(args: AgendaCreateArgs, now: number): number | null {
        if (args.startAt) return TimeUtils.parseAt(args.startAt);
        if (args.startAfter) return now + relativeToMs(args.startAfter);
        return null;
    }

    private hasSchedulePatch(patch: AgendaUpdatePatch): boolean {
        return patch.at !== undefined || patch.after !== undefined || patch.every !== undefined || patch.cron !== undefined;
    }

    private hasTriggerFieldPatch(patch: AgendaUpdatePatch): boolean {
        return patch.timezone !== undefined || patch.action !== undefined || patch.message !== undefined;
    }

    private inferCategory(args: AgendaCreateArgs): AgendaCategory {
        // Automation 仅指由 Invoke 触发的 AI 自动化任务；Send/Notify 都属于"提醒"语义。
        if (args.action === AgendaTriggerAction.Invoke) return AgendaCategory.Automation;
        if (args.every || args.cron) return AgendaCategory.Routine;
        if (args.at || args.after) return AgendaCategory.Reminder;
        return AgendaCategory.Todo;
    }

    private inferCompletionMode(category: AgendaCategory): AgendaCompletionMode {
        return category === AgendaCategory.Todo ? AgendaCompletionMode.Item : AgendaCompletionMode.None;
    }

    private inferDueAt(args: AgendaCreateArgs): number | null {
        if (args.at) return TimeUtils.parseAt(args.at);
        if (args.after) return Date.now() + relativeToMs(args.after);
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
            triggers: record.triggers.map(t => ({ ...t, enabled: Boolean(t.enabled) })),
            occurrences: record.occurrences,
        };
    }

    private static matchesFilter(item: AgendaItemView, filter?: AgendaListFilter): boolean {
        const status = filter?.status ?? AgendaStatus.Pending;
        if (status !== 'all' && item.status !== status) return false;
        if (filter?.category && item.category !== filter.category) return false;
        if (filter?.priority && item.priority !== filter.priority) return false;
        const view = filter?.view ?? AgendaListView.Todo;
        if (view === AgendaListView.All) return true;
        if (view === AgendaListView.Routine) return item.category === AgendaCategory.Routine;
        if (view === AgendaListView.Automation) return item.category === AgendaCategory.Automation || item.triggers.some(t => t.action !== AgendaTriggerAction.Notify);
        if (view === AgendaListView.Upcoming) return item.triggers.some(t => t.enabled && t.nextFireAt);
        return item.category !== AgendaCategory.Automation;
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
