import fs from 'fs';
import path from 'path';

/** 目录遍历 schema 的统一默认值，供两端 schema 共用以保持一致 */
export const DEFAULT_WALK_MAX_DEPTH = 3;
export const DEFAULT_WALK_LIMIT = 200;

export interface WalkTreeOptions {
    /** Max recursion depth (1 = current directory only). Default Infinity. */
    maxDepth?: number;
    /** Names to skip (matches base name only). */
    ignore?: Iterable<string>;
    /** Stop after this many entries (files + directories). Default Infinity. */
    limit?: number;
}

export interface WalkTreeResult {
    /** Relative paths; directories are suffixed with `/`. */
    items: string[];
    dirCount: number;
    fileCount: number;
    /** True when `limit` was reached and traversal stopped early. */
    truncated: boolean;
}

/**
 * Synchronous depth-first directory walk producing a flat list of relative paths.
 * Directories are emitted before their contents and suffixed with `/`.
 * Within each directory, sub-directories are listed before files; both groups are sorted by `localeCompare`.
 */
export function walkTree(rootDir: string, options: WalkTreeOptions = {}): WalkTreeResult {
    const maxDepth = options.maxDepth ?? Infinity;
    const limit = options.limit ?? Infinity;
    const ignore = options.ignore instanceof Set ? options.ignore : new Set(options.ignore ?? []);

    const items: string[] = [];
    let dirCount = 0;
    let fileCount = 0;
    let truncated = false;

    function visit(dir: string, rel: string, depth: number): void {
        if (truncated) return;
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { return; }

        entries.sort((a, b) => {
            const aDir = a.isDirectory() ? 0 : 1;
            const bDir = b.isDirectory() ? 0 : 1;
            return aDir !== bDir ? aDir - bDir : a.name.localeCompare(b.name);
        });

        for (const entry of entries) {
            if (truncated) return;
            if (ignore.has(entry.name)) continue;

            const childRel = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                dirCount++;
                items.push(`${childRel}/`);
                if (depth < maxDepth) visit(path.join(dir, entry.name), childRel, depth + 1);
            } else {
                fileCount++;
                items.push(childRel);
            }
            if (items.length >= limit) { truncated = true; return; }
        }
    }

    visit(rootDir, '', 1);
    return { items, dirCount, fileCount, truncated };
}

/** 标准 walkTree 汇总文本：`N directories, M files[, truncated at K entries]` */
export function formatWalkSummary(result: WalkTreeResult, limit?: number): string {
    const parts: string[] = [
        `${result.dirCount} director${result.dirCount === 1 ? 'y' : 'ies'}`,
        `${result.fileCount} file${result.fileCount === 1 ? '' : 's'}`,
    ];
    if (result.truncated) {
        parts.push(limit != null && Number.isFinite(limit) ? `truncated at ${limit} entries` : 'truncated');
    }
    return parts.join(', ');
}

/**
 * 一站式：遍历目录并渲染为标准文本输出（`${rootDir}:` 头 + 扁平路径列表 + 空行 + 汇总）。
 * 调用方只需根据自身策略提供 `rootDir` 和 options，得到可直接写入工具结果的完整文本。
 */
export function formatWalkTree(rootDir: string, options: WalkTreeOptions = {}): string {
    const result = walkTree(rootDir, options);
    return [`${rootDir}:`, ...result.items, '', formatWalkSummary(result, options.limit)].join('\n');
}
