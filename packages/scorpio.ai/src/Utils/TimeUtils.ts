import { CronJob } from "cron";

/**
 * 通用时间工具集合。Agenda 专属的"相对时长解析 / 触发器下次发火计算"留在
 * `Agenda/time.ts`，本类只承担与具体业务无关的时间原语。
 */
export class TimeUtils {
    /** Node `setTimeout` 接受的最大延迟（约 24.85 天）。超过会立即触发，调度需自行分段。 */
    static readonly MAX_TIMEOUT_MS = 2_147_483_647;

    /** 当前时间戳（毫秒）。等价 `Date.now()`，仅用于让调用点在语义上更明确。 */
    static now(): number {
        return Date.now();
    }

    static sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /** 解析 ISO/RFC2822 等可被 `Date.parse` 接受的时间串，无效值抛错。 */
    static parseAt(value: string): number {
        const ts = Date.parse(value);
        if (!Number.isFinite(ts)) throw new Error(`Invalid datetime: ${value}`);
        return ts;
    }

    /** 给定 cron 表达式与时区，返回下一次触发的毫秒时间戳。 */
    static computeCronNext(expr: string, timezone?: string | null): number {
        const job = CronJob.from({
            cronTime: expr,
            timeZone: timezone || undefined,
            onTick: () => undefined,
            start: false,
        });
        return job.nextDate().toMillis();
    }

    /** 英文 "Nd/Nh/Nm ago / just now"。适合简短日志/标签。 */
    static formatTimeAgo(timestamp: number): string {
        const diff = Date.now() - timestamp;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);
        if (days > 0) return `${days}d ago`;
        if (hours > 0) return `${hours}h ago`;
        if (minutes > 0) return `${minutes}m ago`;
        return "just now";
    }

    /** "ISO (X 分钟前/后)" 中文相对时间。适合给用户看的提醒/调度展示。 */
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
