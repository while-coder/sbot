const DURATION_RE = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/;

/**
 * 判断表达式是否为 cron 格式（含空格分隔的 5+ 字段）
 */
function isCron(expr: string): boolean {
    return expr.trim().split(/\s+/).length >= 5;
}

/**
 * 将时长简写转为 cron 表达式。
 * - "30m" → "0/30 * * * *"（秒级不支持，最小粒度为分钟）
 * - "2h"  → "0 0/2 * * *"
 * - "1h30m" → 无法用单条 cron 表示，转为分钟间隔 "0/90 * * * *"（仅 <=59 有效，否则返回 null）
 * - 已是 cron → 原样返回
 *
 * @returns cron 表达式，或 null 表示无法转换（需用 setInterval 兜底）
 */
export function durationToCron(expr: string): string | null {
    const trimmed = expr.trim();
    if (isCron(trimmed)) return trimmed;

    const match = trimmed.match(DURATION_RE);
    if (!match) return null;

    const hours = parseInt(match[1] || '0', 10);
    const minutes = parseInt(match[2] || '0', 10);
    const seconds = parseInt(match[3] || '0', 10);

    if (hours === 0 && minutes === 0 && seconds === 0) return null;

    // 秒级忽略，最小粒度为分钟
    const totalMinutes = hours * 60 + minutes + (seconds > 0 ? 1 : 0);

    if (totalMinutes <= 0) return null;

    // 纯小时间隔
    if (totalMinutes % 60 === 0 && totalMinutes >= 60) {
        const h = totalMinutes / 60;
        return h <= 23 ? `0 */${h} * * *` : null;
    }

    // 分钟间隔（<=59 才能用 cron */N 表示）
    if (totalMinutes <= 59) {
        return `*/${totalMinutes} * * * *`;
    }

    // 超过 59 分钟且不是整小时倍数，无法用标准 cron 表示
    return null;
}

/**
 * 将时长简写解析为毫秒数（用于 setInterval 兜底）
 */
export function durationToMs(expr: string): number | null {
    const trimmed = expr.trim();
    if (isCron(trimmed)) return null;

    const match = trimmed.match(DURATION_RE);
    if (!match) return null;

    const hours = parseInt(match[1] || '0', 10);
    const minutes = parseInt(match[2] || '0', 10);
    const seconds = parseInt(match[3] || '0', 10);

    const ms = (hours * 3600 + minutes * 60 + seconds) * 1000;
    return ms > 0 ? ms : null;
}
