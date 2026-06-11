import { TimeUtils } from "scorpio.ai";
import { type HeartbeatCommonRow } from "../Core/Database";

export interface ThrottleVerdict {
    pass: boolean;
    reason?: string;        // 拒绝时的原因，写日志用
    resetDaily?: boolean;   // 跨日，调用方需要把 dailySentCount 归零、dailySentDate 更新
    today?: string;         // resetDaily=true 或 pass=true 时给出的"今天"
}

/**
 * 决定一次"实际发送"是否被允许。
 */
export function checkThrottle(row: HeartbeatCommonRow, now: number): ThrottleVerdict {
    const today = TimeUtils.formatDateKey(now, row.activeHoursTimezone);

    if (row.minGapMinutes > 0 && row.lastSentAt != null) {
        const gapMs = row.minGapMinutes * TimeUtils.MINUTE_MS;
        if (now - row.lastSentAt < gapMs) {
            return { pass: false, reason: `min-gap not reached (${Math.round((now - row.lastSentAt) / TimeUtils.MINUTE_MS)}min < ${row.minGapMinutes}min)` };
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
export function recordSentPatch(row: HeartbeatCommonRow, now: number): Partial<HeartbeatCommonRow> {
    const today = TimeUtils.formatDateKey(now, row.activeHoursTimezone);
    const sameDay = row.dailySentDate === today;
    return {
        lastSentAt: now,
        dailySentDate: today,
        dailySentCount: sameDay ? row.dailySentCount + 1 : 1,
    };
}
