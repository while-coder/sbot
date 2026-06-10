import { TimeUtils } from "../Utils/TimeUtils";
import { AgendaTimeUnit, AgendaTriggerKind, type AgendaRelativeTime, type AgendaTrigger } from "./types";

/** Agenda 默认触发宽限窗口：错过该时长的 absolute 触发被视为 missed。 */
export const DEFAULT_GRACE_MS = 24 * 60 * 60 * 1000;

export function relativeToMs(value: AgendaRelativeTime): number {
    const amount = Math.max(1, Math.floor(value.amount));
    switch (value.unit) {
        case AgendaTimeUnit.Minute: return amount * 60 * 1000;
        case AgendaTimeUnit.Hour:   return amount * 60 * 60 * 1000;
        case AgendaTimeUnit.Day:    return amount * 24 * 60 * 60 * 1000;
        case AgendaTimeUnit.Week:   return amount * 7 * 24 * 60 * 60 * 1000;
        default: throw new Error(`Unsupported time unit: ${(value as any).unit}`);
    }
}

export function computeInitialNextFire(kind: AgendaTriggerKind, expr: string, now = Date.now(), timezone?: string | null): number | null {
    if (kind === AgendaTriggerKind.Absolute) {
        return TimeUtils.parseAt(expr);
    }
    if (kind === AgendaTriggerKind.Interval) {
        const interval = parseInt(expr, 10);
        if (!Number.isFinite(interval) || interval <= 0) throw new Error(`Invalid interval milliseconds: ${expr}`);
        return now + interval;
    }
    return TimeUtils.computeCronNext(expr, timezone);
}

export function computeNextAfterFire(trigger: AgendaTrigger, now = Date.now()): number | null {
    if (trigger.kind === AgendaTriggerKind.Absolute) return null;
    if (trigger.kind === AgendaTriggerKind.Interval) {
        const interval = parseInt(trigger.expr, 10);
        if (!Number.isFinite(interval) || interval <= 0) return null;
        return now + interval;
    }
    if (trigger.kind === AgendaTriggerKind.Cron) return TimeUtils.computeCronNext(trigger.expr, trigger.timezone);
    return null;
}
