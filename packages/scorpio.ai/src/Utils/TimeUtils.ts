import { CronJob } from "cron";

export class TimeUtils {
    static readonly SECOND_MS = 1_000;
    static readonly MINUTE_MS = 60 * TimeUtils.SECOND_MS;
    static readonly HOUR_MS = 60 * TimeUtils.MINUTE_MS;
    static readonly DAY_MS = 24 * TimeUtils.HOUR_MS;

    static readonly MAX_TIMEOUT_MS = 2_147_483_647;

    static now(): number {
        return Date.now();
    }

    static sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    static parseAt(value: string): number {
        const ts = Date.parse(value);
        if (!Number.isFinite(ts)) throw new Error(`Invalid datetime: ${value}`);
        return ts;
    }

    static computeCronNext(expr: string, timezone?: string | null): number {
        const job = CronJob.from({
            cronTime: expr,
            timeZone: timezone || undefined,
            onTick: () => undefined,
            start: false,
        });
        return job.nextDate().toMillis();
    }

    static formatTimeAgo(timestamp: number): string {
        const diff = Date.now() - timestamp;
        const minutes = Math.floor(diff / TimeUtils.MINUTE_MS);
        const hours = Math.floor(diff / TimeUtils.HOUR_MS);
        const days = Math.floor(diff / TimeUtils.DAY_MS);
        if (days > 0) return `${days}d ago`;
        if (hours > 0) return `${hours}h ago`;
        if (minutes > 0) return `${minutes}m ago`;
        return "just now";
    }

    static formatDateTime(timestamp = Date.now(), timezone?: string | null): string {
        const options: Intl.DateTimeFormatOptions | undefined = timezone ? { timeZone: timezone } : undefined;
        return new Date(timestamp).toLocaleString("en-US", options);
    }

    static formatDateKey(timestamp: number, timezone?: string | null): string {
        const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit" };
        if (timezone) options.timeZone = timezone;
        return new Date(timestamp).toLocaleDateString("en-CA", options);
    }

    static isNowInHourRange(startHour: number, endHour: number, timezone?: string | null): boolean {
        return TimeUtils.isHourInRange(TimeUtils.getHour(Date.now(), timezone), startHour, endHour);
    }

    static isHourInRange(hour: number, startHour: number, endHour: number): boolean {
        if (startHour <= endHour) {
            return hour >= startHour && hour < endHour;
        }
        return hour >= startHour || hour < endHour;
    }

    static getHour(timestamp: number, timezone?: string | null): number {
        if (!timezone) return new Date(timestamp).getHours();
        const part = new Intl.DateTimeFormat("en-US", {
            timeZone: timezone,
            hour: "numeric",
            hourCycle: "h23",
        }).formatToParts(new Date(timestamp)).find(p => p.type === "hour");
        return Number(part?.value ?? 0);
    }

    static computeJitterDelay(baseMs: number, minPct: number, maxPct: number, minMs = TimeUtils.SECOND_MS): { delayMs: number; factor: number } {
        const min = Number.isFinite(minPct) ? minPct : 100;
        const max = Number.isFinite(maxPct) ? maxPct : min;
        const lo = Math.max(1, Math.min(min, max));
        const hi = Math.max(lo, Math.max(min, max));
        const factor = lo + Math.random() * (hi - lo);
        return {
            factor,
            delayMs: Math.max(minMs, Math.round(baseMs * factor / 100)),
        };
    }

    static formatWhen(ts: number | null | undefined): string {
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
}
