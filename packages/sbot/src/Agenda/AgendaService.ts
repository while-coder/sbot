import {
    AgendaCategory,
    AgendaCompletionMode,
    AgendaOccurrenceStatus,
    AgendaPriority,
    AgendaSource,
    AgendaStatus,
    AgendaTriggerAction,
    AgendaTriggerKind,
    type AgendaCreateArgs,
    type AgendaCreateResult,
    type AgendaItemView,
    type AgendaListFilter,
    type AgendaToolDescs,
    type AgendaTrigger,
    type AgendaUpdatePatch,
    type IAgendaService,
    type IAgendaSyncExtractor,
    type AgendaSyncAction,
    AgendaSyncActionType,
} from "scorpio.ai";
import type { AgendaRecord } from "./AgendaStore";
import { agendaStore } from "./AgendaStore";
import { LoggerService } from "../Core/LoggerService";
import { agendaTriggerEngine } from "./TriggerEngine";
import { computeInitialNextFire, DEFAULT_GRACE_MS, formatWhen, parseAt, relativeToMs } from "./time";
import type { AgendaItemRow, AgendaOccurrenceRow, AgendaStoredItemRow, AgendaTriggerRow } from "./types";

const logger = LoggerService.getLogger("AgendaService.ts");

export class AgendaService implements IAgendaService {
    constructor(
        private profileId: number,
        private channelSessionId: number,
        private toolDescs: AgendaToolDescs,
        private syncExtractor?: IAgendaSyncExtractor,
    ) {}

    getToolDescs(): AgendaToolDescs {
        return this.toolDescs;
    }

    async create(args: AgendaCreateArgs): Promise<AgendaCreateResult> {
        const content = args.content?.trim();
        if (!content) throw new Error("content is required");
        const now = Date.now();
        const category = args.category ?? this.inferCategory(args);
        const completionMode = args.completionMode ?? this.inferCompletionMode(args, category);
        const action = args.action ?? (category === AgendaCategory.Automation ? AgendaTriggerAction.Invoke : AgendaTriggerAction.Notify);
        const dueAt = this.inferDueAt(args);

        const existing = await this.findNearDuplicate(content, dueAt);
        if (existing) return { item: existing, created: false, existed: true };

        const record = await agendaStore.createItem(this.profileId, id => ({
            item: {
                id,
                content,
                status: AgendaStatus.Pending,
                priority: args.priority ?? AgendaPriority.Normal,
                category,
                completionMode,
                dueAt,
                source: args.source ?? AgendaSource.Tool,
                lastTouchedTurnId: null,
                createdAt: now,
                updatedAt: now,
                doneAt: null,
            },
            triggers: [],
            occurrences: [],
            fireLogs: [],
        }));

        const trigger = await this.createTriggerIfNeeded(record.item, args, action, now);
        if (trigger) await agendaTriggerEngine.reload(trigger.id);
        const view = await this.getView(record.item.id) as AgendaItemView;
        return { item: view, created: true, existed: false };
    }

    static async listAll(filter?: AgendaListFilter): Promise<AgendaItemView[]> {
        return AgendaService.buildList((await agendaStore.listAllItems()).map(ref => ref.data), filter);
    }

    async list(filter?: AgendaListFilter): Promise<AgendaItemView[]> {
        return AgendaService.buildList((await agendaStore.listProfileItems(this.profileId)).map(ref => ref.data), filter);
    }

    private static buildList(records: AgendaRecord[], filter?: AgendaListFilter): AgendaItemView[] {
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
        const fields: Partial<AgendaStoredItemRow> = { updatedAt: now };
        if (patch.content != null && patch.content.trim()) fields.content = patch.content.trim();
        if (patch.category != null) fields.category = patch.category;
        if (patch.priority != null) fields.priority = patch.priority;
        if (patch.completionMode != null) fields.completionMode = patch.completionMode;
        if (patch.dueAt !== undefined) fields.dueAt = patch.dueAt === null ? null : parseAt(patch.dueAt);

        const data = await agendaStore.updateItem(id, fields);
        const updatedItem = data?.item;
        if (!updatedItem) return null;

        if (this.hasSchedulePatch(patch)) {
            const category = updatedItem.category as AgendaCategory;
            const action = patch.action ?? (category === AgendaCategory.Automation ? AgendaTriggerAction.Invoke : AgendaTriggerAction.Notify);
            const trigger = await this.createTriggerIfNeeded(updatedItem, {
                content: updatedItem.content,
                category,
                priority: updatedItem.priority as AgendaPriority,
                completionMode: updatedItem.completionMode as AgendaCompletionMode,
                at: patch.at,
                after: patch.after,
                every: patch.every,
                cron: patch.cron,
                timezone: patch.timezone ?? undefined,
                action,
                message: patch.message ?? undefined,
            }, action, now);
            await this.disableItemTriggers(id, trigger?.id);
            if (trigger) await agendaTriggerEngine.reload(trigger.id);
        } else if (this.hasTriggerFieldPatch(patch)) {
            const triggerFields: Partial<AgendaTriggerRow> = {};
            if (patch.timezone !== undefined) triggerFields.timezone = patch.timezone;
            if (patch.action !== undefined) triggerFields.action = patch.action;
            if (patch.message !== undefined) triggerFields.message = patch.message?.trim() || null;
            const record = await agendaStore.findByItemId(id);
            const activeTriggers = record?.data.triggers.filter(t => t.enabled) ?? [];
            for (const trigger of activeTriggers) await agendaStore.updateTrigger(trigger.id, triggerFields);
            await agendaTriggerEngine.reloadItem(id);
        } else {
            await agendaTriggerEngine.reloadItem(id);
        }
        return this.getView(id);
    }

    async complete(id: number): Promise<AgendaItemView | null> {
        const item = await this.requireOwnedItem(id);
        if (!item) return null;
        const now = Date.now();
        if (item.completionMode === AgendaCompletionMode.Occurrence) {
            const occ = await this.firstPendingOccurrence(id);
            if (occ) {
                await agendaStore.updateOccurrence(occ.id, {
                    status: AgendaOccurrenceStatus.Done,
                    doneAt: now,
                });
                return this.getView(id);
            }
        }
        await agendaStore.updateItem(id, {
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
        await agendaStore.updateItem(id, {
            status: AgendaStatus.Cancelled,
            updatedAt: now,
        });
        await this.disableItemTriggers(id);
        return this.getView(id);
    }

    async skipNext(id: number): Promise<AgendaItemView | null> {
        const item = await this.requireOwnedItem(id);
        if (!item) return null;
        const record = await agendaStore.findByItemId(id);
        const trigger = record?.data.triggers
            .filter(t => t.enabled && t.nextFireAt)
            .sort((a, b) => (a.nextFireAt ?? 0) - (b.nextFireAt ?? 0))[0];
        if (!trigger) return this.getView(id);
        if (trigger.kind === AgendaTriggerKind.Absolute) {
            await agendaStore.updateTrigger(trigger.id, {
                enabled: false,
                nextFireAt: null,
                skipNextFireAt: trigger.nextFireAt,
                skipFireCount: trigger.fireCount ?? 0,
            });
            agendaTriggerEngine.cancel(trigger.id);
        } else {
            await agendaStore.updateTrigger(trigger.id, {
                skipNextFireAt: trigger.nextFireAt,
                skipFireCount: trigger.fireCount ?? 0,
            });
            await agendaTriggerEngine.reload(trigger.id);
        }
        return this.getView(id);
    }

    static async delete(id: number): Promise<AgendaRecord | null> {
        const data = await agendaStore.deleteItem(id);
        if (data) for (const trigger of data.triggers) agendaTriggerEngine.cancel(trigger.id);
        return data;
    }

    static async fireLogs(id: number): Promise<AgendaRecord["fireLogs"]> {
        const record = await agendaStore.findByItemId(id);
        return [...(record?.data.fireLogs ?? [])].sort((a, b) => b.firedAt - a.firedAt);
    }

    async formatForLLM(filter?: AgendaListFilter): Promise<string> {
        const items = await this.list(filter);
        if (items.length === 0) return "No agenda items.";
        const lines = items.map(item => {
            const next = AgendaService.firstNextFire(item);
            const due = item.dueAt ? ` due=${formatWhen(item.dueAt)}` : '';
            const nextText = next ? ` next=${formatWhen(next)}` : '';
            const occ = item.occurrences?.filter(o => o.status === AgendaOccurrenceStatus.Pending).length ?? 0;
            const occText = occ > 0 ? ` pending_occurrences=${occ}` : '';
            return `#${item.id} [${item.status}/${item.category}/${item.priority}/${item.completionMode}] ${item.content}${due}${nextText}${occText}`;
        });
        return `${items.length} agenda item(s):\n\n${lines.join('\n')}`;
    }

    async extractFromConversation(userMessage: string, assistantMessages?: string[]): Promise<void> {
        if (!this.syncExtractor) return;
        try {
            const existing = await this.list({ status: 'all', view: 'all', limit: 80 });
            const actions = await this.syncExtractor.extract(userMessage, assistantMessages ?? [], existing);
            if (actions.length === 0) return;
            for (const action of actions) await this.applySyncAction(action);
        } catch (e: any) {
            logger.warn(`Agenda sync failed: ${e.message}`);
        }
    }

    private async applySyncAction(action: AgendaSyncAction): Promise<void> {
        if (action.type === AgendaSyncActionType.Create) {
            await this.create({ ...action.args, source: AgendaSource.Sync });
        } else if (action.type === AgendaSyncActionType.Update) {
            await this.update(action.id, action.patch);
        } else if (action.type === AgendaSyncActionType.Complete) {
            await this.complete(action.id);
        } else if (action.type === AgendaSyncActionType.Cancel) {
            await this.cancel(action.id);
        }
    }

    private async createTriggerIfNeeded(item: AgendaItemRow, args: AgendaCreateArgs, action: AgendaTriggerAction, now: number): Promise<AgendaTriggerRow | null> {
        let kind: AgendaTriggerKind | null = null;
        let expr = '';
        let nextFireAt: number | null = null;
        let maxFires = 1;

        if (args.at) {
            kind = AgendaTriggerKind.Absolute;
            expr = new Date(parseAt(args.at)).toISOString();
            nextFireAt = computeInitialNextFire(kind, expr, now, args.timezone);
        } else if (args.after) {
            kind = AgendaTriggerKind.Absolute;
            expr = new Date(now + relativeToMs(args.after)).toISOString();
            nextFireAt = computeInitialNextFire(kind, expr, now, args.timezone);
        } else if (args.every) {
            kind = AgendaTriggerKind.Interval;
            expr = String(relativeToMs(args.every));
            nextFireAt = computeInitialNextFire(kind, expr, now, args.timezone);
            maxFires = 0;
        } else if (args.cron?.trim()) {
            kind = AgendaTriggerKind.Cron;
            expr = args.cron.trim();
            nextFireAt = computeInitialNextFire(kind, expr, now, args.timezone);
            maxFires = 0;
        }
        if (!kind) return null;

        return agendaStore.appendTrigger(item.id, {
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
            graceWindowMs: DEFAULT_GRACE_MS,
            skipNextFireAt: null,
            skipFireCount: null,
            createdAt: now,
        });
    }

    private hasSchedulePatch(patch: AgendaUpdatePatch): boolean {
        return patch.at !== undefined || patch.after !== undefined || patch.every !== undefined || patch.cron !== undefined;
    }

    private hasTriggerFieldPatch(patch: AgendaUpdatePatch): boolean {
        return patch.timezone !== undefined || patch.action !== undefined || patch.message !== undefined;
    }

    private inferCategory(args: AgendaCreateArgs): AgendaCategory {
        if (args.action === AgendaTriggerAction.Invoke || args.action === AgendaTriggerAction.Send) return AgendaCategory.Automation;
        if (args.every || args.cron) return AgendaCategory.Routine;
        if (args.at || args.after) return AgendaCategory.Reminder;
        return AgendaCategory.Todo;
    }

    private inferCompletionMode(args: AgendaCreateArgs, category: AgendaCategory): AgendaCompletionMode {
        if (category === AgendaCategory.Automation) return AgendaCompletionMode.None;
        if (category === AgendaCategory.Reminder) return AgendaCompletionMode.None;
        if (category === AgendaCategory.Routine) {
            const text = args.content;
            if (/(周报|日报|报告|提交|交付|汇报|report|submit|deliver|hand\s*in|turn\s*in|send\s+.*report)/i.test(text)) return AgendaCompletionMode.Occurrence;
            return AgendaCompletionMode.None;
        }
        return AgendaCompletionMode.Item;
    }

    private inferDueAt(args: AgendaCreateArgs): number | null {
        if (args.at) return parseAt(args.at);
        if (args.after) return Date.now() + relativeToMs(args.after);
        return null;
    }

    private async findNearDuplicate(content: string, dueAt: number | null): Promise<AgendaItemView | null> {
        const records = await agendaStore.listProfileItems(this.profileId);
        const normalized = this.normalize(content);
        for (const record of records.slice(-30).reverse()) {
            const row = record.data.item;
            if (row.status !== AgendaStatus.Pending) continue;
            if (this.normalize(row.content) !== normalized) continue;
            if (dueAt == null && row.dueAt == null) return AgendaService.buildView(record.data);
            if (dueAt != null && row.dueAt != null && Math.abs(dueAt - row.dueAt) < 2 * 60 * 1000) return AgendaService.buildView(record.data);
        }
        return null;
    }

    private normalize(value: string): string {
        return value.replace(/\s+/g, '').toLowerCase();
    }

    private async requireOwnedItem(id: number): Promise<AgendaItemRow | null> {
        const record = await agendaStore.findByItemId(id);
        const item = record?.data.item;
        if (!item || item.profileId !== this.profileId) return null;
        return item;
    }

    private async getView(id: number): Promise<AgendaItemView | null> {
        const record = await agendaStore.findByItemId(id);
        if (!record || record.data.item.profileId !== this.profileId) return null;
        return AgendaService.buildView(record.data);
    }

    static buildView(record: AgendaRecord): AgendaItemView {
        return {
            ...record.item,
            status: record.item.status as AgendaStatus,
            priority: record.item.priority as AgendaPriority,
            category: record.item.category as AgendaCategory,
            completionMode: record.item.completionMode as AgendaCompletionMode,
            source: record.item.source as AgendaSource,
            triggers: record.triggers.map(t => ({
                ...t,
                kind: t.kind as AgendaTriggerKind,
                action: t.action as AgendaTriggerAction,
                enabled: Boolean(t.enabled),
            })) as AgendaTrigger[],
            occurrences: record.occurrences.map(o => ({
                ...o,
                status: o.status as AgendaOccurrenceStatus,
            })),
        } as AgendaItemView;
    }

    private static matchesFilter(item: AgendaItemView, filter?: AgendaListFilter): boolean {
        const status = filter?.status ?? AgendaStatus.Pending;
        if (status !== 'all' && item.status !== status) return false;
        if (filter?.category && item.category !== filter.category) return false;
        if (filter?.priority && item.priority !== filter.priority) return false;
        const view = filter?.view ?? 'todo';
        if (view === 'all') return true;
        if (view === 'routine') return item.category === AgendaCategory.Routine;
        if (view === 'automation') return item.category === AgendaCategory.Automation || item.triggers.some(t => t.action !== AgendaTriggerAction.Notify);
        if (view === 'upcoming') return item.triggers.some(t => t.enabled && t.nextFireAt);
        return item.category !== AgendaCategory.Automation;
    }

    private static firstNextFire(item: AgendaItemView): number | null {
        const values = item.triggers
            .filter(t => t.enabled && t.nextFireAt)
            .map(t => t.nextFireAt as number)
            .sort((a, b) => a - b);
        return values[0] ?? null;
    }

    private async firstPendingOccurrence(itemId: number): Promise<AgendaOccurrenceRow | null> {
        const record = await agendaStore.findByItemId(itemId);
        return record?.data.occurrences
            .filter(o => o.status === AgendaOccurrenceStatus.Pending)
            .sort((a, b) => a.scheduledAt - b.scheduledAt)[0] ?? null;
    }

    private async disableItemTriggers(itemId: number, exceptTriggerId?: number): Promise<void> {
        const ids = await agendaStore.updateActiveTriggersByItem(itemId, { enabled: false, nextFireAt: null }, exceptTriggerId);
        for (const id of ids) agendaTriggerEngine.cancel(id);
    }
}
