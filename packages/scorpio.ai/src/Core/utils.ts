import { readdirSync, statSync } from "fs";
import { join } from "path";

/**
 * 扫描目录，返回匹配扩展名的文件名（去掉扩展名）列表
 * @param dir 目录路径
 * @param exts 扩展名，如 ".db", ".json"，支持多个
 */
export function listThreadIds(dir: string, ...exts: string[]): string[] {
    try {
        const set = new Set<string>();
        for (const f of readdirSync(dir)) {
            const ext = exts.find((e) => f.endsWith(e));
            if (ext) set.add(f.slice(0, -ext.length));
        }
        return [...set].sort();
    } catch {
        return [];
    }
}

/**
 * 扫描目录，返回子目录名列表
 */
export function listSubDirs(dir: string): string[] {
    try {
        return readdirSync(dir)
            .filter(f => { try { return statSync(join(dir, f)).isDirectory(); } catch { return false; } })
            .sort();
    } catch {
        return [];
    }
}

export function truncate(str: string, maxLen: number, ellipsis = '…'): string {
    return str.length > maxLen ? str.slice(0, maxLen) + ellipsis : str;
}

export function parseJson<T>(str: string, defaultValue: T | undefined): T | undefined {
    try {
        return JSON.parse(str) as T;
    } catch {
        return defaultValue;
    }
}

/**
 * 把任意 error 规整成可读文本，统一所有 catch 点的错误输出。
 *
 * 对于 LLM/API 错误（LangChain / openai / anthropic SDK / axios / fetch），
 * `.message` 往往只是笼统的 "400" / "Bad Request"，真正的错误体（如
 * "context length exceeded"、"invalid tools"）藏在以下字段之一里，按优先级
 * 逐个尝试：
 *   - openai/anthropic SDK：error.error（已解析的响应 body，含 .message/.type）
 *   - axios 风格：error.response.data
 *   - fetch 风格：error.response.body / error.body
 *   - 嵌套 cause
 * 对于普通 Error，退化为 name + message；最终兜底 String(error)。
 *
 * 默认只输出单行摘要（用于回显给用户/AI 的展示场景）；日志场景传第二个
 * 参数 `true` 会追加完整 stack（不截断），便于排查。
 */
export function formatError(error: unknown, withStack = false): string {
    const e = error as any;
    if (!e) return String(error);

    const status = e.status ?? e.response?.status ?? e.cause?.status;
    const name = e.name && e.name !== 'Error' ? e.name : undefined;

    // 候选错误体来源（按优先级）
    const bodyCandidates: any[] = [
        e.error,                         // openai/anthropic SDK：解析后的 body
        e.response?.data,                // axios
        e.response?.body,                // 部分封装
        e.body,                          // fetch 裸响应体
        e.cause?.error,
        e.cause?.response?.data,
    ];

    let bodyText: string | undefined;
    for (const body of bodyCandidates) {
        const text = describeErrorBody(body, withStack);
        if (text) { bodyText = text; break; }
    }

    // SDK 的 error.message 有时已含详情；只有当它不只是裸状态码时才采用
    const msg = typeof e.message === 'string' && e.message.trim() && !/^\d+$/.test(e.message.trim())
        ? e.message.trim()
        : undefined;

    const parts = [
        name,
        status ? `status=${status}` : undefined,
        msg,
        bodyText ? `body=${bodyText}` : undefined,
    ].filter(Boolean);

    let text = parts.length ? parts.join(' ') : String(error);

    // 日志场景：追加完整堆栈（不截断）
    if (withStack) {
        const stack = typeof e.stack === 'string' ? e.stack.trim() : '';
        if (stack) text += `\n${stack}`;
    }

    return text;
}

/** 把响应体对象/字符串规整成可读文本。日志场景不截断，展示场景截断到 800 字符。 */
function describeErrorBody(body: any, full = false): string | undefined {
    if (body == null) return undefined;
    if (typeof body === 'string') {
        const t = body.trim();
        return t ? (full ? t : truncate(t, 800)) : undefined;
    }
    if (typeof body === 'object') {
        // 常见形状：{ error: { message, type } } 或 { message } 或 { error: "..." }
        const inner = body.error ?? body;
        const msg = typeof inner === 'string' ? inner : inner?.message;
        const type = typeof inner === 'object' ? inner?.type : undefined;
        const text = [type, msg].filter(Boolean).join(': ') || JSON.stringify(body);
        return full ? text : truncate(text, 800);
    }
    return undefined;
}
