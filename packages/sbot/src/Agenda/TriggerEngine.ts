import {
    AgendaCompletionMode,
    AgendaOccurrenceStatus,
    AgendaStatus,
    AgendaTriggerAction,
    AgendaTriggerKind,
    computeNextAfterFire,
    DEFAULT_GRACE_MS,
    TimeUtils,
    type IAgendaStore,
    type IAgendaTriggerEngine,
    type AgendaItem,
    type AgendaTrigger,
} from "scorpio.ai";
import { LoggerService } from "../Core/LoggerService";
import { TimerExecutor } from "../Core/TimerExecutor";
import { triggerSession } from "../Core/triggerSession";
import { resolveAgendaDelivery } from "./Delivery";

const logger = LoggerService.getLogger("Agenda/TriggerEngine.ts");

/** Absolute（一次性）触发投递失败后的重试间隔。 */
const ABSOLUTE_RETRY_INTERVAL_MS = 5 * 60 * 1000;
/** 距原定时刻超过该窗口仍未投递成功则放弃，避免无限重试。 */
const ABSOLUTE_RETRY_DEADLINE_MS = 30 * 60 * 1000;

/**
 * 单 profile 的触发器运行时。绑定一个 profileId + store，
 * 内部 timer 池仅追踪该 profile 的 trigger，跨 profile 操作由 AgendaTriggerEnginePool 协调。
 */
export class AgendaTriggerEngine implements IAgendaTriggerEngine {
    private executor = new TimerExecutor<NodeJS.Timeout>({ name: "AgendaTrigger", stop: handle => clearTimeout(handle), concurrencyGuard: true });
    private started = false;

    constructor(
        private readonly profileId: number,
        private readonly store: IAgendaStore,
    ) {}

    async start(): Promise<void> {
        this.started = true;
        const triggers = await this.store.listEnabledTriggers();
        for (const trigger of triggers) {
            await this.reload(trigger.id);
        }
        logger.info(`Agenda trigger engine [profile=${this.profileId}] started, loaded ${triggers.length} trigger(s)`);
    }

    stopAll(): void {
        this.started = false;
        this.executor.stopAll();
    }

    cancel(triggerId: number): void {
        this.executor.cancel(triggerId);
    }

    async reload(triggerId: number): Promise<void> {
        this.executor.cancel(triggerId);
        const found = await this.store.findTrigger(triggerId);
        const trigger = found?.trigger;
        const item = found?.data.item;
        if (!trigger || !trigger.enabled || !item) return;
        if (item.status !== AgendaStatus.Pending) {
            await this.store.updateTrigger(trigger.id, { enabled: false, nextFireAt: null });
            return;
        }

        let nextFireAt = trigger.nextFireAt;
        const now = Date.now();
        if (!nextFireAt || nextFireAt <= now - DEFAULT_GRACE_MS) {
            if (trigger.kind === 'absolute' && nextFireAt) {
                await this.markMissed(trigger, nextFireAt);
                return;
            }
            nextFireAt = computeNextAfterFire(trigger, now);
            await this.store.updateTrigger(trigger.id, { nextFireAt, enabled: nextFireAt != null });
        }
        if (!nextFireAt) return;
        this.schedule(trigger.id, nextFireAt);
    }

    async reloadItem(itemId: number): Promise<void> {
        const record = await this.store.findItem(itemId);
        for (const trigger of record?.triggers ?? []) await this.reload(trigger.id);
    }

    private schedule(triggerId: number, nextFireAt: number): void {
        if (!this.started) return;
        const delay = Math.max(0, nextFireAt - Date.now());
        const handle = setTimeout(() => {
            void this.onTimer(triggerId);
        }, Math.min(delay, TimeUtils.MAX_TIMEOUT_MS));
        this.executor.set(triggerId, handle);
    }

    private async onTimer(triggerId: number): Promise<void> {
        const found = await this.store.findTrigger(triggerId);
        const trigger = found?.trigger;
        if (!trigger || !trigger.enabled || !trigger.nextFireAt) return;
        const now = Date.now();
        if (trigger.nextFireAt > now) {
            this.schedule(trigger.id, trigger.nextFireAt);
            return;
        }
        await this.fire(trigger);
    }

    async fire(trigger: AgendaTrigger): Promise<void> {
        await this.executor.execute(trigger.id, async () => {
            const found = await this.store.findTrigger(trigger.id);
            const freshTrigger = found?.trigger;
            const item = found?.data.item;
            if (!freshTrigger || !freshTrigger.enabled || !item) return;
            if (item.status !== AgendaStatus.Pending) {
                await this.store.updateTrigger(freshTrigger.id, { enabled: false, nextFireAt: null });
                return;
            }

            const scheduledAt = freshTrigger.nextFireAt ?? Date.now();
            if (this.shouldSkip(freshTrigger, scheduledAt)) {
                await this.advanceAfterFire(freshTrigger, item, scheduledAt, false);
                return;
            }

            let delivered = false;
            const delivery = await resolveAgendaDelivery(item, freshTrigger);
            try {
                if (!delivery) throw new Error("no delivery session");
                const message = this.buildMessage(item, freshTrigger);
                const result = await triggerSession({
                    targetId: delivery.id,
                    message,
                    aiProcess: freshTrigger.action === AgendaTriggerAction.Invoke,
                    tag: `Agenda trigger [${freshTrigger.id}]`,
                });
                delivered = result.ok;
                if (!result.ok) logger.warn(`Agenda trigger [${freshTrigger.id}] delivery failed`);
            } catch (e: any) {
                logger.warn(`Agenda trigger [${freshTrigger.id}] failed: ${e?.message ?? String(e)}`);
            }

            // 一次性 absolute 触发投递失败时延后重试，避免提醒在临时通道异常下永久丢失。
            // expr 在 absolute trigger 中是创建时写入的 ISO 字符串，重试不会改写它；
            // 因此用 parseAt(expr) 作为"原计划时刻"，距离 deadline 超过 30 分钟则放弃。
            // 放弃时只禁用 trigger，item 保持 Pending（避免投递失败被误标为完成）。
            if (!delivered && freshTrigger.kind === AgendaTriggerKind.Absolute && freshTrigger.maxFires === 1) {
                const originalAt = this.parseAbsoluteExpr(freshTrigger.expr);
                if (originalAt != null) {
                    const retryAt = Date.now() + ABSOLUTE_RETRY_INTERVAL_MS;
                    if (retryAt - originalAt < ABSOLUTE_RETRY_DEADLINE_MS) {
                        await this.store.updateTrigger(freshTrigger.id, { nextFireAt: retryAt });
                        this.schedule(freshTrigger.id, retryAt);
                        logger.warn(`Agenda trigger [${freshTrigger.id}] delivery failed, retry at ${new Date(retryAt).toISOString()}`);
                        return;
                    }
                    await this.store.updateTrigger(freshTrigger.id, {
                        enabled: false,
                        nextFireAt: null,
                        skipNextFireAt: null,
                        skipFireCount: null,
                    });
                    logger.warn(`Agenda trigger [${freshTrigger.id}] delivery failed past retry deadline; giving up`);
                    return;
                }
                await this.store.updateTrigger(freshTrigger.id, {
                    enabled: false,
                    nextFireAt: null,
                    skipNextFireAt: null,
                    skipFireCount: null,
                });
                logger.warn(`Agenda trigger [${freshTrigger.id}] delivery failed; expr unparseable, giving up`);
                return;
            }

            // 仅在投递成功时记录 occurrence，避免失败积累虚假 pending 条目。
            if (delivered && item.completionMode === AgendaCompletionMode.Occurrence) {
                await this.store.appendOccurrence(item.id, {
                    itemId: item.id,
                    scheduledAt,
                    status: AgendaOccurrenceStatus.Pending,
                    doneAt: null,
                });
            }

            await this.advanceAfterFire(freshTrigger, item, scheduledAt, true);
        });
    }

    private parseAbsoluteExpr(expr: string): number | null {
        try { return TimeUtils.parseAt(expr); }
        catch { return null; }
    }

    private buildMessage(item: AgendaItem, trigger: AgendaTrigger): string {
        const message = trigger.message || item.content;
        if (trigger.action === AgendaTriggerAction.Notify) return `提醒：${message} (#${item.id})`;
        return message;
    }

    private shouldSkip(trigger: AgendaTrigger, scheduledAt: number): boolean {
        if (trigger.skipFireCount != null) return trigger.skipFireCount === (trigger.fireCount ?? 0);
        return Boolean(trigger.skipNextFireAt && Math.abs(trigger.skipNextFireAt - scheduledAt) < 60 * 1000);
    }

    private async markMissed(trigger: AgendaTrigger, scheduledAt: number): Promise<void> {
        await this.store.updateTrigger(trigger.id, {
            enabled: false,
            nextFireAt: null,
            skipNextFireAt: null,
            skipFireCount: null,
        });
        logger.warn(`Agenda trigger [${trigger.id}] missed scheduled fire at ${new Date(scheduledAt).toISOString()} beyond grace window`);
    }

    private async advanceAfterFire(trigger: AgendaTrigger, item: AgendaItem, scheduledAt: number, countFire: boolean): Promise<void> {
        const now = Date.now();
        const fireCount = countFire ? (trigger.fireCount ?? 0) + 1 : trigger.fireCount ?? 0;
        const maxReached = trigger.maxFires > 0 && fireCount >= trigger.maxFires;
        const nextFireAt = maxReached ? null : computeNextAfterFire({ ...trigger, fireCount }, now);
        const enabled = Boolean(nextFireAt);

        await this.store.updateTrigger(trigger.id, {
            fireCount,
            lastFiredAt: countFire ? now : trigger.lastFiredAt,
            nextFireAt,
            enabled,
            skipNextFireAt: null,
            skipFireCount: null,
        });

        if (countFire && item.completionMode === AgendaCompletionMode.None && !enabled) {
            await this.store.updateItem(item.id, {
                status: AgendaStatus.Done,
                doneAt: now,
                updatedAt: now,
            });
        }

        if (enabled && nextFireAt) this.schedule(trigger.id, nextFireAt);
        logger.info(`Agenda trigger [${trigger.id}] advanced from ${new Date(scheduledAt).toISOString()} to ${nextFireAt ? new Date(nextFireAt).toISOString() : 'disabled'}`);
    }
}
