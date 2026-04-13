import { readdirSync, statSync } from "fs";
import { join } from "path";

export const NowDate = (): number => Date.now();

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

export const sleep = (ms: number): Promise<void> =>
    new Promise(resolve => setTimeout(resolve, ms));

export function parseJson<T>(str: string, defaultValue: T | undefined): T | undefined {
    try {
        return JSON.parse(str) as T;
    } catch {
        return defaultValue;
    }
}
