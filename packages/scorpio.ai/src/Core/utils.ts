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

    const status = e.status ?? e.status_code ?? e.response?.status ?? e.cause?.status ?? e.cause?.status_code;
    const statusText = firstText(e.statusText, e.response?.statusText, e.cause?.statusText);
    const name = e.name && e.name !== 'Error' ? e.name : undefined;

    // 候选错误体来源（按优先级）
    const bodyCandidates: any[] = [
        e.error,                         // openai/anthropic SDK：解析后的 body
        e.response?.data,                // axios
        e.response?.body,                // 部分封装
        e.body,                          // fetch 裸响应体
        e.errorDetails,                  // Gemini SDK
        e.details,                       // 常见 provider 详情字段
        e.cause?.error,
        e.cause?.response?.data,
    ];

    let bodyText: string | undefined;
    for (const body of bodyCandidates) {
        const text = describeErrorBody(body, withStack);
        if (text) { bodyText = text; break; }
    }

    // SDK 的 error.message 有时已含详情；只有当它不只是无信息量文本（裸状态码 / "no body" 等）时才采用
    const rawMsg = typeof e.message === 'string' ? e.message.trim() : '';
    const msg = rawMsg && !isUninformative(rawMsg) ? rawMsg : undefined;
    const code = firstText(e.code, e.error?.code, e.response?.data?.code, e.cause?.code);
    const type = firstText(e.type, e.error?.type, e.response?.data?.type, e.cause?.type);
    const param = firstText(e.param, e.error?.param, e.response?.data?.param);
    const requestId = firstText(
        e.requestID,
        e.request_id,
        e.error?.requestID,
        e.error?.request_id,
        getHeader(e.headers, 'x-request-id'),
        getHeader(e.headers, 'request-id'),
        getHeader(e.response?.headers, 'x-request-id'),
        getHeader(e.response?.headers, 'request-id'),
    );
    const headersText = describeHeaders(e.headers ?? e.response?.headers);

    const parts = [
        name,
        status ? `status=${status}` : undefined,
        statusText ? `statusText=${statusText}` : undefined,
        msg,
        bodyText ? `body=${bodyText}` : undefined,
        code ? `code=${code}` : undefined,
        type ? `type=${type}` : undefined,
        param ? `param=${param}` : undefined,
        requestId ? `requestId=${requestId}` : undefined,
        headersText ? `headers=${headersText}` : undefined,
    ].filter(Boolean);

    let text = parts.length ? parts.join(' ') : String(error);

    // 既提取不到错误体、又没有可用 message（错误不透明，如 message 只是裸 "400" / "no body"）时，
    // 兜底把原始对象所有自有属性 dump 出来，确保能看到具体原因。有 message 的普通错误不打 raw，避免噪声。
    if (!bodyText && !msg) {
        const raw = dumpErrorObject(e);
        if (raw && raw !== '{}') text += ` raw=${raw}`;
    }

    // 日志场景：追加完整堆栈（不截断）
    if (withStack) {
        const stack = typeof e.stack === 'string' ? e.stack.trim() : '';
        if (stack) text += `\n${stack}`;
    }

    return text;
}

/** 判断一段错误文本是否无信息量（裸状态码 / 空响应占位 / 通用兜底语），用于决定是否触发 raw dump。 */
function isUninformative(text: string): boolean {
    const t = text.trim().toLowerCase();
    if (!t) return true;
    if (/^\d+$/.test(t)) return true;                       // 纯状态码，如 "400"
    if (/^(?:\d+\s+)?status code\s*\(no body\)$/.test(t)) return true;
    if (/^\(no status code or body\)$/.test(t)) return true;
    return /^(no body|no response|no content|bad request|error|failed|failure|none|null|undefined|\[object object\]|\{\})$/.test(t);
}

/** 把响应体对象/字符串规整成可读文本。无信息量（"no body" 等）返回 undefined，交给 raw 兜底。日志场景不截断，展示场景截断到 800 字符。 */
function describeErrorBody(body: any, full = false): string | undefined {
    if (body == null) return undefined;
    let text: string | undefined;
    if (typeof body === 'string') {
        text = body.trim() || undefined;
    } else if (typeof body === 'object') {
        // 常见及兼容接口形状：{ error: { message, type } } / { message } / { msg } / { detail }
        const inner = body.error ?? body;
        const msg = typeof inner === 'string'
            ? inner
            : firstText(inner?.message, inner?.msg, inner?.detail, inner?.error_description, inner?.data?.message);
        const type = typeof inner === 'object' ? inner?.type : undefined;
        const code = typeof inner === 'object' ? inner?.code : undefined;
        // 日志场景保留完整 provider JSON；用户展示场景只取关键摘要，避免把大响应落进消息历史。
        text = full
            ? safeStringify(body)
            : [type, code, msg].filter(Boolean).join(': ') || safeStringify(body);
    }
    if (!text || isUninformative(text)) return undefined;
    return full ? text : truncate(text, 800);
}

function firstText(...values: any[]): string | undefined {
    for (const value of values) {
        if (value == null || value === '') continue;
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    }
    return undefined;
}

function getHeader(headers: any, name: string): string | undefined {
    if (!headers) return undefined;
    try {
        if (typeof headers.get === 'function') return headers.get(name) ?? undefined;
        const value = headers[name] ?? headers[name.toLowerCase()];
        return Array.isArray(value) ? value.join(', ') : firstText(value);
    } catch {
        return undefined;
    }
}

/** 响应头常含 request id / 网关诊断信息；排除 cookie 和认证字段后写入日志。 */
function describeHeaders(headers: any): string | undefined {
    if (!headers) return undefined;
    try {
        const entries: [string, string][] = typeof headers.entries === 'function'
            ? [...headers.entries()]
            : Object.entries(headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : String(value)]);
        const safeEntries = entries.filter(([key]) => !/^(set-cookie|cookie|authorization|proxy-authorization)$/i.test(key));
        return safeEntries.length ? safeStringify(Object.fromEntries(safeEntries)) : undefined;
    } catch {
        return undefined;
    }
}

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

/**
 * 把 error 对象的所有自有属性（含 SDK 常用的非枚举字段，如 status / error / code / response）
 * 序列化成 JSON。作为 formatError 抓不到错误体时的兜底，确保能看到原始错误结构。
 * 自动跳过 stack（已由 formatError(err, true) 追加），并安全处理循环引用与不可序列化值。
 */
function dumpErrorObject(error: unknown): string {
    const e = error as any;
    if (e == null) return String(error);
    try {
        const seen = new WeakSet();
        const dumpOwn = (v: any): Record<string, any> => {
            const out: Record<string, any> = {};
            for (const k of Object.getOwnPropertyNames(v)) {
                if (k === 'stack') continue;
                try {
                    let val = v[k];
                    if (typeof val === 'object' && val !== null) {
                        if (seen.has(val)) { out[k] = '[Circular]'; continue; }
                        seen.add(val);
                        if (val instanceof Error) {
                            out[k] = { name: val.name, message: val.message, ...dumpOwn(val) };
                        } else if (typeof Headers !== 'undefined' && val instanceof Headers) {
                            out[k] = Object.fromEntries(val.entries());
                        } else {
                            try { out[k] = JSON.parse(JSON.stringify(val)); }
                            catch { out[k] = dumpOwn(val); }
                        }
                    } else {
                        out[k] = val;
                    }
                } catch {
                    out[k] = '<unreadable>';
                }
            }
            return out;
        };
        const obj = e instanceof Error
            ? { name: e.name, message: e.message, ...dumpOwn(e) }
            : dumpOwn(e);
        return JSON.stringify(obj);
    } catch {
        return String(e);
    }
}
