import {
    SessionDeliveryMode,
    TimeUtils,
    formatError,
    type ILogger,
} from "scorpio.ai";
import {
    AgendaStatus,
    AgendaTriggerKind,
    type AgendaItem,
    type AgendaTrigger,
} from "../types";
import { computeNextAfterFire, DEFAULT_GRACE_MS } from "../time";
import type { IAgendaStore } from "../Storage/IAgendaStore";
import type { IAgendaTriggerEngine } from "./IAgendaTriggerEngine";
import { TimerExecutor } from "./TimerExecutor";

/** trigger_fire.message 描述的截断长度。 */
const FIRE_LOG_DESC_MAX = 100;

export interface AgendaDeliveryRequest {
    agendaId: string;
    item: AgendaItem;
    trigger: AgendaTrigger;
}

export type AgendaDeliveryHandler = (
    request: AgendaDeliveryRequest,
) => Promise<{ ok: boolean; error?: string }>;

/** Absolute（一次性）触发投递失败后的重试间隔。 */
const ABSOLUTE_RETRY_INTERVAL_MS = 5 * 60 * 1000;
/** 距原定时刻超过该窗口仍未投递成功则放弃，避免无限重试。 */
const ABSOLUTE_RETRY_DEADLINE_MS = 30 * 60 * 1000;

/**
 * 单 agenda 模板的触发器运行时。绑定一个 agendaId + store，
 * 内部 timer 池仅追踪该模板的 trigger，跨模板操作由 AgendaTriggerEnginePool 协调。
 */
export class AgendaTriggerEngine implements IAgendaTriggerEngine {
    private executor = new TimerExecutor<NodeJS.Timeout>({ stop: handle => clearTimeout(handle), concurrencyGuard: true });
    private started = false;
    private startPromise?: Promise<void>;
    private readonly agendaName: string;

    constructor(
        private readonly agendaId: string,
        private readonly store: IAgendaStore,
        private readonly delivery: AgendaDeliveryHandler,
        private readonly logger?: ILogger,
        agendaName?: string,
    ) {
        this.agendaName = agendaName?.trim() || agendaId;
    }

    private logEngine(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
        const line = `[日程:${this.agendaName}] ${message}`;
        switch (level) {
            case 'debug':
                this.logger?.debug(line);
                break;
            case 'info':
                this.logger?.info(line);
                break;
            case 'warn':
                this.logger?.warn(line);
                break;
            case 'error':
                this.logger?.error(line);
                break;
        }
    }

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
        this.logEngine('info', `触发引擎已启动：已加载 ${triggers.length} 条触发器`);
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

            const { ok: delivered, error: deliverError } = await this.deliver(item, freshTrigger);

            // 纯日志：每次实际投递尝试（不论成功与否）都落一行。必须在 absolute
            // 重试/放弃分支前写入，否则最终 Expired 的条目会丢失失败审计记录。
            if (delivered) {
                this.logEngine('info', `触发器已${freshTrigger.action === SessionDeliveryMode.Invoke ? '触发 AI 执行' : '投递'}：#${freshTrigger.id}（${this.briefDesc(freshTrigger.message ?? "")}）`);
            }
            await this.store.insertTriggerFire({
                triggerId: freshTrigger.id,
                itemId: item.id,
                scheduledAt,
                firedAt: Date.now(),
                delivered,
                action: freshTrigger.action,
                message: this.fireLogMessage(freshTrigger, delivered, deliverError),
            });

            // 一次性 absolute 触发投递失败时延后重试，避免提醒在临时通道异常下永久丢失。
            // expr 在 absolute trigger 中是创建时写入的 ISO 字符串，重试不会改写它；
            // 因此用 parseAt(expr) 作为"原计划时刻"，距离 deadline 超过 30 分钟则放弃。
            // 放弃时禁用 trigger；若它是 item 最后一条有效 trigger，则 item 置 Expired。
            if (!delivered && freshTrigger.kind === AgendaTriggerKind.Absolute && freshTrigger.maxFires === 1) {
                const originalAt = this.parseAbsoluteExpr(freshTrigger.expr);
                if (originalAt != null) {
                    const retryAt = Date.now() + ABSOLUTE_RETRY_INTERVAL_MS;
                    if (retryAt - originalAt < ABSOLUTE_RETRY_DEADLINE_MS) {
                        await this.store.updateTrigger(freshTrigger.id, { nextFireAt: retryAt });
                        this.schedule(freshTrigger.id, retryAt);
                        this.logEngine('warn', `触发器投递失败，安排重试：#${freshTrigger.id}（${this.briefDesc(freshTrigger.message ?? "")}），重试时刻=${new Date(retryAt).toISOString()}`);
                        return;
                    }
                    await this.disableMissedTrigger(freshTrigger);
                    this.logEngine('warn', `触发器投递失败且已超出重试期限，放弃：#${freshTrigger.id}（${this.briefDesc(freshTrigger.message ?? "")}）`);
                    return;
                }
                await this.disableMissedTrigger(freshTrigger);
                this.logEngine('warn', `触发器投递失败且原定时刻不可解析，放弃：#${freshTrigger.id}（${this.briefDesc(freshTrigger.message ?? "")}）`);
                return;
            }

            await this.advanceAfterFire(freshTrigger, item, scheduledAt);
        });
    }

    /**
     * admin 手动触发：立即按 trigger.action 投递一次，**不改动触发器调度状态**——
     * fireCount / nextFireAt / maxFires / enabled 均保持不变。
     * 仍会落一行 trigger_fire 日志（纯记录，便于审计手动触发）。
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
            const res = await this.deliver(item, trigger);
            ok = res.ok;
            if (ok) {
                this.logEngine('info', `触发器手动投递成功：#${trigger.id}（${this.briefDesc(trigger.message ?? "")}）`);
            }
            await this.store.insertTriggerFire({
                triggerId: trigger.id,
                itemId: item.id,
                scheduledAt: Date.now(),
                firedAt: Date.now(),
                delivered: ok,
                action: trigger.action,
                message: this.fireLogMessage(trigger, res.ok, res.error),
            });
        });
        if (!ran) throw new Error(`Trigger ${triggerId} is currently firing`);
        return { ok };
    }

    /**
     * 解析投递目标并按 trigger.action 投递一次 message。
     * 只负责"投出去"，不触碰任何调度/状态字段；fire() 与 fireManual() 共用。
     * 返回是否投递成功 + 失败原因（无会话 / 通道异常均记 warn 并返回 ok:false）。
     */
    private async deliver(item: AgendaItem, trigger: AgendaTrigger): Promise<{ ok: boolean; error?: string }> {
        try {
            const result = await this.delivery({ agendaId: this.agendaId, item, trigger });
            if (!result.ok) {
                this.logEngine('warn', `触发器投递失败：#${trigger.id}（${this.briefDesc(trigger.message ?? "")}）${result.error ? `，原因=${result.error}` : ''}`);
            }
            return result;
        } catch (e: any) {
            const error = formatError(e);
            this.logEngine('warn', `触发器投递异常：#${trigger.id}（${this.briefDesc(trigger.message ?? "")}），错误=${formatError(e, true)}`);
            return { ok: false, error };
        }
    }

    /**
     * trigger_fire.message 的取值，两行「内容 / 结果」：
     *   内容：<触发内容（截断）>
     *   结果：已发送 / 发送失败: <原因> / 已触发 AI 执行
     * invoke 的结果是 "已触发 AI 执行"——AI 异步执行，触发当下拿不到最终结果。
     */
    private fireLogMessage(trigger: AgendaTrigger, ok: boolean, error?: string): string {
        const content = this.briefDesc(trigger.message ?? "");
        let result: string;
        if (trigger.action === SessionDeliveryMode.Invoke) result = "已触发 AI 执行";
        else if (ok) result = "已发送";
        else result = error ? `发送失败：${error}` : "发送失败";
        return `内容：${content}\n结果：${result}`;
    }

    /** 压成一行并截断，给 trigger_fire.message 用。 */
    private briefDesc(text: string): string {
        const oneLine = text.replace(/\s+/g, " ").trim();
        return oneLine.length > FIRE_LOG_DESC_MAX ? `${oneLine.slice(0, FIRE_LOG_DESC_MAX - 1)}…` : oneLine;
    }

    private parseAbsoluteExpr(expr: string): number | null {
        try { return TimeUtils.parseAt(expr); }
        catch { return null; }
    }

    private async markMissed(trigger: AgendaTrigger, scheduledAt: number): Promise<void> {
        await this.disableMissedTrigger(trigger);
        this.logEngine('warn', `触发器错过触发时刻且超出宽限窗口，已停用：#${trigger.id}（${this.briefDesc(trigger.message ?? "")}），原定时刻=${new Date(scheduledAt).toISOString()}`);
    }

    /**
     * 停用一条已经无法再正常触发的一次性 trigger。若它是所属 item 的最后一条
     * 有效 trigger，则把 Pending 置为 Expired；还有其它有效 trigger 时 item 继续 Pending。
     * 整段放在 store 的互斥区内，避免与并发 addTrigger 交错而误判为“已无有效 trigger”。
     */
    private async disableMissedTrigger(trigger: AgendaTrigger): Promise<void> {
        await this.store.runExclusive(async () => {
            await this.store.updateTrigger(trigger.id, {
                enabled: false,
                nextFireAt: null,
            });
            const record = await this.store.findItem(trigger.itemId);
            if (!record || record.item.status !== AgendaStatus.Pending) return;
            if (record.triggers.some(candidate => candidate.enabled)) return;
            const now = Date.now();
            await this.store.updateItem(trigger.itemId, {
                status: AgendaStatus.Expired,
                doneAt: null,
                updatedAt: now,
            });
        });
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

        // 自动置 Done 的条件：本 item 的**所有** trigger 都已耗尽（无任何 enabled 的）。
        // 只有当前这条耗尽还不够——多 trigger 时其它条可能仍在循环/未到 max。
        // updateTrigger 上面已把当前条的 enabled 落库，这里 findItem 取到的就是最新状态。
        // 无限循环的 trigger 永远 enabled → item 永不自动 Done；纯 Todo（无 trigger）走不到这里，仍由 complete() 手动关。
        if (!enabled) {
            const record = await this.store.findItem(item.id);
            const anyActive = record?.triggers.some(t => t.enabled) ?? false;
            if (!anyActive) {
                await this.store.updateItem(item.id, {
                    status: AgendaStatus.Done,
                    doneAt: now,
                    updatedAt: now,
                });
            }
        }

        if (enabled && nextFireAt) this.schedule(trigger.id, nextFireAt);
        this.logEngine('info', `触发器已推进：#${trigger.id}（${this.briefDesc(trigger.message ?? "")}），本次时刻=${new Date(scheduledAt).toISOString()}，下一时刻=${nextFireAt ? new Date(nextFireAt).toISOString() : '已停用'}`);
    }
}
