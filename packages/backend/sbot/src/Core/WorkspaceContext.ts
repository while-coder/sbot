import fs from 'fs';
import path from 'path';

export interface DiscoveredContext {
    path: string;
    content: string;
    level: number;
}

export const DEFAULT_WORKSPACE_CONTEXT_NAMES = ['SBOT.md', 'AGENTS.md'];
const MAX_FILE_SIZE = 10 * 1024; // 10KB
const DEFAULT_MAX_LEVELS = 3;

/**
 * 从 workPath 开始，向上扫描最多 maxLevels 级父目录，查找上下文文件。
 * 文件名匹配大小写不敏感（SBOT.md / sbot.md / Sbot.md 等价）。
 * 返回按层级从高到低排列（根目录在前，workPath 在后）。
 */
export function loadWorkspaceContext(
    workPath: string,
    fileNames: string[] = DEFAULT_WORKSPACE_CONTEXT_NAMES,
    maxLevels: number = DEFAULT_MAX_LEVELS,
): DiscoveredContext[] {
    if (fileNames.length === 0) return [];
    const lowerPriority = fileNames.map(n => n.toLowerCase());
    const results: DiscoveredContext[] = [];
    let currentDir = path.resolve(workPath);
    const root = path.parse(currentDir).root;

    for (let level = 0; level <= maxLevels; level++) {
        const found = findContextFile(currentDir, lowerPriority);
        if (found) {
            const result = readAndValidate(found, level);
            if (result) results.push(result);
        }
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir || parentDir === root) break;
        currentDir = parentDir;
    }

    return results.reverse();
}

/** 大小写不敏感匹配：按 lowerPriority 顺序返回目录里第一个命中的文件。 */
function findContextFile(dir: string, lowerPriority: string[]): string | null {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return null;
    }
    const filesByLower = new Map<string, string>();
    for (const e of entries) {
        if (e.isFile()) filesByLower.set(e.name.toLowerCase(), e.name);
    }
    for (const lower of lowerPriority) {
        const actual = filesByLower.get(lower);
        if (actual) return path.join(dir, actual);
    }
    return null;
}

function readAndValidate(filePath: string, level: number): DiscoveredContext | null {
    try {
        const stat = fs.statSync(filePath);
        let content: string;
        if (stat.size > MAX_FILE_SIZE) {
            const buf = Buffer.alloc(MAX_FILE_SIZE);
            const fd = fs.openSync(filePath, 'r');
            fs.readSync(fd, buf, 0, MAX_FILE_SIZE, 0);
            fs.closeSync(fd);
            content = buf.toString('utf-8') + '\n... [truncated]';
        } else {
            content = fs.readFileSync(filePath, 'utf-8');
        }

        return { path: filePath, content, level };
    } catch {
        return null;
    }
}
