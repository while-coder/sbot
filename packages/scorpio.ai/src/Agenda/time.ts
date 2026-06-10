import { CronJob } from "cron";
import { AgendaTriggerKind, type AgendaRelativeTime, type AgendaTriggerRow } from "./types";

export const DEFAULT_GRACE_MS = 24 * 60 * 60 * 1000;
export const MAX_TIMEOUT_MS = 2_147_483_647;

export function relativeToMs(value: AgendaRelativeTime): number {
    const amount = Math.max(1, Math.floor(value.amount));
    switch (value.unit) {
        case 'minute': return amount * 60 * 1000;
        case 'hour': return amount * 60 * 60 * 1000;
        case 'day': return amount * 24 * 60 * 60 * 1000;
        case 'week': return amount * 7 * 24 * 60 * 60 * 1000;
        default: throw new Error(`Unsupported time unit: ${(value as any).unit}`);
    }
}

export function parseAt(value: string): number {
    const ts = Date.parse(value);
    if (!Number.isFinite(ts)) throw new Error(`Invalid datetime: ${value}`);
    return ts;
}

export function computeInitialNextFire(kind: AgendaTriggerKind, expr: string, now = Date.now(), timezone?: string | null): number | null {
    if (kind === AgendaTriggerKind.Absolute) {
        return parseAt(expr);
    }
    if (kind === AgendaTriggerKind.Interval) {
        const interval = parseInt(expr, 10);
        if (!Number.isFinite(interval) || interval <= 0) throw new Error(`Invalid interval milliseconds: ${expr}`);
        return now + interval;
    }
    return computeCronNext(expr, timezone);
}

export function computeNextAfterFire(trigger: AgendaTriggerRow, now = Date.now()): number | null {
    if (trigger.kind === AgendaTriggerKind.Absolute) return null;
    if (trigger.kind === AgendaTriggerKind.Interval) {
        const interval = parseInt(trigger.expr, 10);
        if (!Number.isFinite(interval) || interval <= 0) return null;
        return now + interval;
    }
    if (trigger.kind === AgendaTriggerKind.Cron) return computeCronNext(trigger.expr, trigger.timezone);
    return null;
}

export function computeCronNext(expr: string, timezone?: string | null): number {
    const job = CronJob.from({
        cronTime: expr,
        timeZone: timezone || undefined,
        onTick: () => undefined,
        start: false,
    });
    return job.nextDate().toMillis();
}

export function formatWhen(ts: number | null | undefined): string {
    if (!ts) return '';
    const date = new Date(ts);
    const diff = ts - Date.now();
    const abs = Math.abs(diff);
    const minutes = Math.round(abs / 60000);
    let rel: string;
    if (minutes < 1) rel = diff >= 0 ? '不到 1 分钟后' : '刚刚';
    else if (minutes < 60) rel = diff >= 0 ? `${minutes} 分钟后` : `${minutes} 分钟前`;
    else {
        const hours = Math.round(minutes / 60);
        if (hours < 24) rel = diff >= 0 ? `${hours} 小时后` : `${hours} 小时前`;
        else {
            const days = Math.round(hours / 24);
            rel = diff >= 0 ? `${days} 天后` : `${days} 天前`;
        }
    }
    return `${date.toISOString()} (${rel})`;
}
