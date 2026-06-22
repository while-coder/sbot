import {
    AgendaCompletionMode,
    AgendaOccurrenceStatus,
    AgendaStatus,
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
 * 单 agenda 模板的触发器运行时。绑定一个 agendaId + store，
 * 内部 timer 池仅追踪该模板的 trigger，跨模板操作由 AgendaTriggerEnginePool 协调。
 */
export class AgendaTriggerEngine implements IAgendaTriggerEngine {
    private executor = new TimerExecutor<NodeJS.Timeout>({ name: "AgendaTrigger", stop: handle => clearTimeout(handle), concurrencyGuard: true });
    private started = false;
    private startPromise?: Promise<void>;

    constructor(
        private readonly agendaId: string,
        private readonly store: IAgendaStore,
    ) {}

    /**
     * 幂等 + 可 await：首次调用真正加载并调度已启用 trigger，并发/重复调用共享同一 promise。
     * 注意 doStart() 会**同步**置 started=true（async 函数在首个 await 前同步执行），
     * 因此懒创建路径下，pool.get() 里 fire-and-forget 调用 start() 后，
     * 紧随其后的 reload()→schedule() 已能看到 started=true，不会被静默丢弃。
     */
    start(): Promise<void> {
        if (!this.startPromise) this.startPromise = this.doStart();
        return this.startPromise;
    }

    private async doStart(): Promise<void> {
        this.started = true;
        const triggers = await this.store.listEnabledTriggers();
        for (const trigger of triggers) {
            await this.reload(trigger.id);
        }
        logger.info(`Agenda trigger engine [agenda=${this.agendaId}] started, loaded ${triggers.length} trigger(s)`);
    }

    stopAll(): void {
        this.started = false;
        this.startPromise = undefined;
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

            const delivered = await this.deliver(item, freshTrigger);

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
                    });
                    logger.warn(`Agenda trigger [${freshTrigger.id}] delivery failed past retry deadline; giving up`);
                    return;
                }
                await this.store.updateTrigger(freshTrigger.id, {
                    enabled: false,
                    nextFireAt: null,
                });
                logger.warn(`Agenda trigger [${freshTrigger.id}] delivery failed; expr unparseable, giving up`);
                return;
            }

            // 仅在投递成功时记录 occurrence，避免失败积累虚假 pending 条目。
            // 新增 pending 前，把上一轮还挂着的 pending 标为 missed——
            // 语义：下一次提醒来了 = 上一次错过了。doneAt = scheduledAt（本次触发时刻）。
            if (delivered && item.completionMode === AgendaCompletionMode.Occurrence) {
                const missedIds = await this.store.markPendingOccurrencesMissed(item.id, scheduledAt);
                if (missedIds.length > 0) {
                    logger.info(`Agenda item [${item.id}] marked ${missedIds.length} pending occurrence(s) as missed`);
                }
                await this.store.appendOccurrence(item.id, {
                    itemId: item.id,
                    scheduledAt,
                    status: AgendaOccurrenceStatus.Pending,
                    doneAt: null,
                });
            }

            await this.advanceAfterFire(freshTrigger, item, scheduledAt);
        });
    }

    /**
     * admin 手动触发：立即按 trigger.action 投递一次，**不改动触发器调度状态**——
     * fireCount / nextFireAt / maxFires / enabled 均保持不变，也不记录 occurrence。
     * 允许对已停用（enabled=false）的 trigger 触发，方便重测或补发已结束的提醒。
     * 复用 executor 并发保护：若该 trigger 正在定时触发中则拒绝，避免重复投递。
     * 返回投递结果；trigger / item 不存在时抛错。
     */
    async fireManual(triggerId: number): Promise<{ ok: boolean }> {
        const found = await this.store.findTrigger(triggerId);
        const trigger = found?.trigger;
        const item = found?.data.item;
        if (!trigger || !item) throw new Error(`Trigger ${triggerId} not found`);
        let ok = false;
        const ran = await this.executor.execute(triggerId, async () => {
            ok = await this.deliver(item, trigger);
        });
        if (!ran) throw new Error(`Trigger ${triggerId} is currently firing`);
        return { ok };
    }

    /**
     * 解析投递目标并按 trigger.action 投递一次 message。
     * 只负责"投出去"，不触碰任何调度/状态字段；fire() 与 fireManual() 共用。
     * 返回是否投递成功（无会话 / 通道异常均记 warn 并返回 false）。
     */
    private async deliver(item: AgendaItem, trigger: AgendaTrigger): Promise<boolean> {
        const delivery = await resolveAgendaDelivery(this.agendaId, item, trigger);
        try {
            if (!delivery) throw new Error("no delivery session");
            const message = this.buildMessage(item, trigger);
            const result = await triggerSession({
                targetId: delivery.id,
                message,
                mode: trigger.action,
                tag: `Agenda trigger [${trigger.id}]`,
            });
            if (!result.ok) logger.warn(`Agenda trigger [${trigger.id}] delivery failed`);
            return result.ok;
        } catch (e: any) {
            logger.warn(`Agenda trigger [${trigger.id}] failed: ${e?.message ?? String(e)}`);
            return false;
        }
    }

    private parseAbsoluteExpr(expr: string): number | null {
        try { return TimeUtils.parseAt(expr); }
        catch { return null; }
    }

    private buildMessage(item: AgendaItem, trigger: AgendaTrigger): string {
        return trigger.message || item.content;
    }

    private async markMissed(trigger: AgendaTrigger, scheduledAt: number): Promise<void> {
        await this.store.updateTrigger(trigger.id, {
            enabled: false,
            nextFireAt: null,
        });
        logger.warn(`Agenda trigger [${trigger.id}] missed scheduled fire at ${new Date(scheduledAt).toISOString()} beyond grace window`);
    }

    private async advanceAfterFire(trigger: AgendaTrigger, item: AgendaItem, scheduledAt: number): Promise<void> {
        const now = Date.now();
        const fireCount = (trigger.fireCount ?? 0) + 1;
        const maxReached = trigger.maxFires > 0 && fireCount >= trigger.maxFires;
        const nextFireAt = maxReached ? null : computeNextAfterFire({ ...trigger, fireCount }, now);
        const enabled = Boolean(nextFireAt);

        await this.store.updateTrigger(trigger.id, {
            fireCount,
            lastFiredAt: now,
            nextFireAt,
            enabled,
        });

        if (item.completionMode === AgendaCompletionMode.None && !enabled) {
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
