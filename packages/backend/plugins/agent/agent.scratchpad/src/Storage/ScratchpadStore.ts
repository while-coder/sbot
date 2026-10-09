import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
    SCRATCHPAD_MAX_ENTRIES,
    SCRATCHPAD_MAX_ENTRY_BYTES,
    SCRATCHPAD_MAX_KEY_CHARS,
    SCRATCHPAD_MAX_TOTAL_BYTES,
    SCRATCHPAD_TTL_MS,
} from "../limits";

/**
 * Scratchpad 存储层：无状态模块函数集，文件即唯一真相源，每次工具调用整读整写。
 *
 * - 不做内存缓存：deleteSession/Sweep 直接操作文件，不存在「内存副本把已删数据写回」的问题
 * - root 由 sbot 侧注入（Config.getScratchpadDir()），本包不依赖 sbot
 * - 64KB 总量上限使整读整写成本可忽略；跨进程竞态由 temp+rename 兜底（最多丢写，不产生半截 JSON）
 */

const FILE_VERSION = 1;

/** key 字符白名单：slug 风格，防路径穿越与 Windows 保留字符。 */
const KEY_PATTERN = /^[\w][\w .()\-]*$/;

export interface ScratchpadEntry {
    content: string;
    updatedAt: number;
}

export type ScratchpadEntries = Record<string, ScratchpadEntry>;

export type ScratchpadWriteResult =
    | { ok: true; overwrote: boolean }
    | { ok: false; error: string };

interface ScratchpadFile {
    version: number;
    entries: ScratchpadEntries;
}

function scratchpadFile(root: string, channelSessionId: number): string {
    return path.join(root, `${channelSessionId}.json`);
}

/** key 合法性：trim 后非空、≤64 字符、命中白名单（首字符须为字母/数字/下划线，防 "…" 之类边界歧义）。 */
function isValidKey(key: string): boolean {
    return key.length > 0
        && key.length <= SCRATCHPAD_MAX_KEY_CHARS
        && KEY_PATTERN.test(key);
}

function emptyFile(): ScratchpadFile {
    return { version: FILE_VERSION, entries: {} };
}

/**
 * 读全会话条目。文件不存在或 JSON 损坏一律返回 {}（数据非关键，不备份不抛错），
 * 下一次 writeEntry 会整写修复。
 */
export function readEntries(root: string, channelSessionId: number): ScratchpadEntries {
    const file = scratchpadFile(root, channelSessionId);
    if (!existsSync(file)) return {};
    try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as ScratchpadFile;
        if (!parsed || typeof parsed !== 'object' || !parsed.entries || typeof parsed.entries !== 'object') return {};
        return parsed.entries;
    } catch {
        return {};
    }
}

/**
 * 写入单条。校验失败返回 { ok:false, error }（error 面向模型，含具体原因与当前用量），
 * 写入失败（磁盘/rename 占用等）同样返回错误字符串，调用方不需要 try/catch。
 * mtime 已超 TTL 的陈旧文件先清空再写，防止「删除钩子删掉的孤儿文件复活」。
 */
export function writeEntry(
    root: string,
    channelSessionId: number,
    key: string,
    content: string,
    now: number = Date.now(),
): ScratchpadWriteResult {
    const trimmedKey = key.trim();
    if (!isValidKey(trimmedKey)) {
        return { ok: false, error: `Invalid key "${key.slice(0, 80)}": use 1-${SCRATCHPAD_MAX_KEY_CHARS} chars (letters, digits, underscore first; spaces . ( ) - allowed).` };
    }

    const contentBytes = Buffer.byteLength(content, 'utf8');
    if (content.trim().length < 1) return { ok: false, error: 'Content is empty.' };
    if (contentBytes > SCRATCHPAD_MAX_ENTRY_BYTES) {
        return { ok: false, error: `Content is ${contentBytes} bytes; limit is ${SCRATCHPAD_MAX_ENTRY_BYTES} bytes per entry.` };
    }

    let entries: ScratchpadEntries;
    try {
        entries = readEntriesForWrite(root, channelSessionId, now);
    } catch (e) {
        return { ok: false, error: `Failed to read scratchpad: ${e instanceof Error ? e.message : String(e)}` };
    }

    const overwrote = trimmedKey in entries;
    if (!overwrote && Object.keys(entries).length >= SCRATCHPAD_MAX_ENTRIES) {
        return { ok: false, error: `Scratchpad is full (${SCRATCHPAD_MAX_ENTRIES} entries); delete_scratchpad an entry first.` };
    }

    const otherBytes = Object.entries(entries)
        .filter(([k]) => k !== trimmedKey)
        .reduce((sum, [, v]) => sum + Buffer.byteLength(v.content, 'utf8'), 0);
    if (otherBytes + contentBytes > SCRATCHPAD_MAX_TOTAL_BYTES) {
        return { ok: false, error: `Scratchpad would hold ${otherBytes + contentBytes} bytes; limit is ${SCRATCHPAD_MAX_TOTAL_BYTES}. Delete entries first.` };
    }

    entries[trimmedKey] = { content, updatedAt: now };

    try {
        mkdirSync(root, { recursive: true });
        const file = scratchpadFile(root, channelSessionId);
        const tmp = `${file}.tmp`;
        writeFileSync(tmp, JSON.stringify({ version: FILE_VERSION, entries } satisfies ScratchpadFile), 'utf8');
        renameSync(tmp, file);
    } catch (e) {
        return { ok: false, error: `Failed to write scratchpad: ${e instanceof Error ? e.message : String(e)}` };
    }
    return { ok: true, overwrote };
}

/** deleteEntry：返回面向模型的结果消息（条目不存在也是正常结果，不报错）。 */
export function deleteEntry(root: string, channelSessionId: number, key: string): string {
    const entries = readEntries(root, channelSessionId);
    const trimmedKey = key.trim();
    if (!(trimmedKey in entries)) return `Not found: "${trimmedKey}". Use read_scratchpad without a key to list entries.`;
    delete entries[trimmedKey];
    try {
        const file = scratchpadFile(root, channelSessionId);
        const tmp = `${file}.tmp`;
        writeFileSync(tmp, JSON.stringify({ version: FILE_VERSION, entries } satisfies ScratchpadFile), 'utf8');
        renameSync(tmp, file);
    } catch (e) {
        return `Failed to delete: ${e instanceof Error ? e.message : String(e)}`;
    }
    return `Deleted "${trimmedKey}"`;
}

export interface ScratchpadListRow {
    key: string;
    bytes: number;
    updatedAt: number;
}

export function listEntries(root: string, channelSessionId: number): ScratchpadListRow[] {
    return Object.entries(readEntries(root, channelSessionId))
        .map(([key, entry]) => ({ key, bytes: Buffer.byteLength(entry.content, 'utf8'), updatedAt: entry.updatedAt }))
        .sort((a, b) => a.key.localeCompare(b.key));
}

/** 会话删除钩子：逐出文件。吞错——不能让清理失败阻断 deleteSession 的后续流程。 */
export function disposeSession(root: string, channelSessionId: number): void {
    try { rmSync(scratchpadFile(root, channelSessionId), { force: true }); } catch { /* ignore */ }
}

/**
 * TTL 清扫：按文件 mtime（写入即刷新）删除超过 ttlMs 未活跃的板。
 * 用 mtime 而非解析内容里的 updatedAt，省一次 JSON.parse；目录不存在直接返回。
 */
export function sweepStale(root: string, ttlMs: number = SCRATCHPAD_TTL_MS, now: number = Date.now()): void {
    let names: string[];
    try { names = readdirSync(root); } catch { return; }
    for (const name of names) {
        if (!name.endsWith('.json')) continue;
        const file = path.join(root, name);
        try {
            if (now - statSync(file).mtimeMs > ttlMs) rmSync(file, { force: true });
        } catch { /* 单文件失败不影响其余清扫 */ }
    }
}

/** writeEntry 专用读：顺带做 TTL 复活检查（mtime 超龄的文件视为空板）。 */
function readEntriesForWrite(root: string, channelSessionId: number, now: number): ScratchpadEntries {
    const file = scratchpadFile(root, channelSessionId);
    if (existsSync(file)) {
        try {
            if (now - statSync(file).mtimeMs > SCRATCHPAD_TTL_MS) return {};
        } catch { /* stat 失败按正常读取走 */ }
    }
    return readEntries(root, channelSessionId);
}
