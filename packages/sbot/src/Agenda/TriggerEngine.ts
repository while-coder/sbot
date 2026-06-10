import {
    AgendaCompletionMode,
    AgendaOccurrenceStatus,
    AgendaStatus,
    AgendaTriggerAction,
} from "scorpio.ai";
import { LoggerService } from "../Core/LoggerService";
import { TimerExecutor } from "../Core/TimerExecutor";
import { triggerSession } from "../Core/triggerSession";
import { agendaStore } from "./AgendaStore";
import { resolveAgendaDelivery } from "./Delivery";
import { computeNextAfterFire, MAX_TIMEOUT_MS } from "./time";
import type { AgendaItemRow, AgendaTriggerRow } from "./types";

const logger = LoggerService.getLogger("Agenda/TriggerEngine.ts");

class AgendaTriggerEngine {
    private executor = new TimerExecutor<NodeJS.Timeout>({ name: "AgendaTrigger", stop: handle => clearTimeout(handle), concurrencyGuard: true });
    private started = false;

    async start(): Promise<void> {
        this.started = true;
        const triggers = await agendaStore.listEnabledTriggers();
        for (const trigger of triggers) {
            await this.reload(trigger.id);
        }
        logger.info(`Agenda trigger engine started, loaded ${triggers.length} trigger(s)`);
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
        const found = await agendaStore.findByTriggerId(triggerId);
        const trigger = found?.trigger;
        const item = found?.data.item;
        if (!trigger || !trigger.enabled || !item) return;
        if (item.status !== AgendaStatus.Pending) {
            await agendaStore.updateTrigger(trigger.id, { enabled: false, nextFireAt: null });
            return;
        }

        let nextFireAt = trigger.nextFireAt;
        const now = Date.now();
        if (!nextFireAt || nextFireAt <= now - trigger.graceWindowMs) {
            if (trigger.kind === 'absolute' && nextFireAt) {
                await this.markMissed(trigger, item, nextFireAt, now);
                return;
            }
            nextFireAt = computeNextAfterFire(trigger, now);
            await agendaStore.updateTrigger(trigger.id, { nextFireAt, enabled: nextFireAt != null });
        }
        if (!nextFireAt) return;
        this.schedule(trigger.id, nextFireAt);
    }

    async reloadItem(itemId: number): Promise<void> {
        const file = await agendaStore.findByItemId(itemId);
        for (const trigger of file?.data.triggers ?? []) await this.reload(trigger.id);
    }

    private schedule(triggerId: number, nextFireAt: number): void {
        if (!this.started) return;
        const delay = Math.max(0, nextFireAt - Date.now());
        const handle = setTimeout(() => {
            void this.onTimer(triggerId);
        }, Math.min(delay, MAX_TIMEOUT_MS));
        this.executor.set(triggerId, handle);
    }

    private async onTimer(triggerId: number): Promise<void> {
        const found = await agendaStore.findByTriggerId(triggerId);
        const trigger = found?.trigger;
        if (!trigger || !trigger.enabled || !trigger.nextFireAt) return;
        const now = Date.now();
        if (trigger.nextFireAt > now) {
            this.schedule(trigger.id, trigger.nextFireAt);
            return;
        }
        await this.fire(trigger);
    }

    async fire(trigger: AgendaTriggerRow): Promise<void> {
        await this.executor.execute(trigger.id, async () => {
            const found = await agendaStore.findByTriggerId(trigger.id);
            const freshTrigger = found?.trigger;
            const item = found?.data.item;
            if (!freshTrigger || !freshTrigger.enabled || !item) return;
            if (item.status !== AgendaStatus.Pending) {
                await agendaStore.updateTrigger(freshTrigger.id, { enabled: false, nextFireAt: null });
                return;
            }

            const scheduledAt = freshTrigger.nextFireAt ?? Date.now();
            if (this.shouldSkip(freshTrigger, scheduledAt)) {
                await this.advanceAfterFire(freshTrigger, item, scheduledAt, false);
                return;
            }

            const delivery = await resolveAgendaDelivery(item, freshTrigger);
            const firedAt = Date.now();
            let ok = false;
            let errorMessage: string | null = null;
            try {
                if (!delivery) throw new Error("no delivery session");
                const message = this.buildMessage(item, freshTrigger);
                const result = await triggerSession({
                    targetId: delivery.id,
                    message,
                    aiProcess: freshTrigger.action === AgendaTriggerAction.Invoke,
                    tag: `Agenda trigger [${freshTrigger.id}]`,
                });
                ok = result.ok;
                if (!ok) errorMessage = "delivery failed";
            } catch (e: any) {
                errorMessage = e?.message ?? String(e);
                logger.warn(`Agenda trigger [${freshTrigger.id}] failed: ${errorMessage}`);
            }

            await agendaStore.appendFireLog(item.id, {
                itemId: item.id,
                triggerId: freshTrigger.id,
                firedAt,
                action: freshTrigger.action,
                channelSessionId: delivery?.id ?? null,
                ok,
                errorMessage,
            });

            if (item.completionMode === AgendaCompletionMode.Occurrence) {
                await agendaStore.appendOccurrence(item.id, {
                    itemId: item.id,
                    triggerId: freshTrigger.id,
                    scheduledAt,
                    status: AgendaOccurrenceStatus.Pending,
                    doneAt: null,
                    createdAt: firedAt,
                });
            }

            await this.advanceAfterFire(freshTrigger, item, scheduledAt, true);
        });
    }

    private buildMessage(item: AgendaItemRow, trigger: AgendaTriggerRow): string {
        const message = trigger.message || item.content;
        if (trigger.action === AgendaTriggerAction.Notify) return `提醒：${message} (#${item.id})`;
        return message;
    }

    private shouldSkip(trigger: AgendaTriggerRow, scheduledAt: number): boolean {
        if (trigger.skipFireCount != null) return trigger.skipFireCount === (trigger.fireCount ?? 0);
        return Boolean(trigger.skipNextFireAt && Math.abs(trigger.skipNextFireAt - scheduledAt) < 60 * 1000);
    }

    private async markMissed(trigger: AgendaTriggerRow, item: AgendaItemRow, scheduledAt: number, now: number): Promise<void> {
        await agendaStore.appendFireLog(item.id, {
            itemId: item.id,
            triggerId: trigger.id,
            firedAt: now,
            action: trigger.action,
            channelSessionId: null,
            ok: false,
            errorMessage: "missed beyond grace window",
        });
        await agendaStore.updateTrigger(trigger.id, {
            enabled: false,
            nextFireAt: null,
            skipNextFireAt: null,
            skipFireCount: null,
        });
        logger.warn(`Agenda trigger [${trigger.id}] missed scheduled fire at ${new Date(scheduledAt).toISOString()} beyond grace window`);
    }

    private async advanceAfterFire(trigger: AgendaTriggerRow, item: AgendaItemRow, scheduledAt: number, countFire: boolean): Promise<void> {
        const now = Date.now();
        const fireCount = countFire ? (trigger.fireCount ?? 0) + 1 : trigger.fireCount ?? 0;
        const maxReached = trigger.maxFires > 0 && fireCount >= trigger.maxFires;
        const nextFireAt = maxReached ? null : computeNextAfterFire({ ...trigger, fireCount }, now);
        const enabled = Boolean(nextFireAt);

        await agendaStore.updateTrigger(trigger.id, {
            fireCount,
            lastFiredAt: countFire ? now : trigger.lastFiredAt,
            nextFireAt,
            enabled,
            skipNextFireAt: null,
            skipFireCount: null,
        });

        if (countFire && item.completionMode === AgendaCompletionMode.None && !enabled) {
            await agendaStore.updateItem(item.id, {
                status: AgendaStatus.Done,
                doneAt: now,
                updatedAt: now,
            });
        }

        if (enabled && nextFireAt) this.schedule(trigger.id, nextFireAt);
        logger.info(`Agenda trigger [${trigger.id}] advanced from ${new Date(scheduledAt).toISOString()} to ${nextFireAt ? new Date(nextFireAt).toISOString() : 'disabled'}`);
    }
}

export const agendaTriggerEngine = new AgendaTriggerEngine();
