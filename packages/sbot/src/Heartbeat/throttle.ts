import { HeartbeatRow } from "../Core/Database";

/**
 * 按 row.activeHoursTimezone 把 ts 折算成 YYYY-MM-DD。
 * 时区缺失时退回本地时区——dailySentDate 只是个用于"跨天重置"的对比 key，时区不严谨不影响正确性，
 * 只要前后两次比较用同一个时区即可。
 */
export function formatLocalDate(ts: number, timezone: string | null): string {
    const d = new Date(ts);
    const opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit' };
    if (timezone) opts.timeZone = timezone;
    // en-CA 输出 yyyy-MM-dd
    return d.toLocaleDateString('en-CA', opts);
}

export interface ThrottleVerdict {
    pass: boolean;
    reason?: string;        // 拒绝时的原因，写日志用
    resetDaily?: boolean;   // 跨日，调用方需要把 dailySentCount 归零、dailySentDate 更新
    today?: string;         // resetDaily=true 或 pass=true 时给出的"今天"
}

/**
 * 决定一次"实际发送"是否被允许。仅检查 smart 模式专属的节流字段；
 * fixed 模式不应调用此函数（fixed 没有 minGapMinutes/dailyLimit 概念）。
 */
export function checkThrottle(row: HeartbeatRow, now: number): ThrottleVerdict {
    const today = formatLocalDate(now, row.activeHoursTimezone);

    if (row.minGapMinutes > 0 && row.lastSentAt != null) {
        const gapMs = row.minGapMinutes * 60_000;
        if (now - row.lastSentAt < gapMs) {
            return { pass: false, reason: `min-gap not reached (${Math.round((now - row.lastSentAt) / 60_000)}min < ${row.minGapMinutes}min)` };
        }
    }

    const resetDaily = row.dailySentDate !== today;

    if (row.dailyLimit > 0 && !resetDaily) {
        if (row.dailySentCount >= row.dailyLimit) {
            return { pass: false, reason: `daily limit reached (${row.dailySentCount}/${row.dailyLimit})` };
        }
    }

    return { pass: true, resetDaily, today };
}

/**
 * 发送成功后调用：返回需要写回数据库的字段。
 * 跨日时把 count 重置为 1，否则 +1。
 */
export function recordSentPatch(row: HeartbeatRow, now: number): Partial<HeartbeatRow> {
    const today = formatLocalDate(now, row.activeHoursTimezone);
    const sameDay = row.dailySentDate === today;
    return {
        lastSentAt: now,
        dailySentDate: today,
        dailySentCount: sameDay ? row.dailySentCount + 1 : 1,
    };
}
