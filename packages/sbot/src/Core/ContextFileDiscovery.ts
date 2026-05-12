import fs from 'fs';
import path from 'path';
import { PromptInjectionDetector, InjectionSeverity } from 'scorpio.ai';

export interface DiscoveredContext {
    path: string;
    content: string;
    level: number;
}

const CONTEXT_FILE_NAMES = ['.sbot.md', 'SBOT.md', 'sbot.md'];
const MAX_FILE_SIZE = 10 * 1024; // 10KB
const DEFAULT_MAX_LEVELS = 3;

const detector = new PromptInjectionDetector();

/**
 * 从 workPath 开始，向上扫描最多 maxLevels 级父目录，查找上下文文件。
 * 返回按层级从高到低排列（根目录在前，workPath 在后）。
 */
export function discoverContextFiles(workPath: string, maxLevels: number = DEFAULT_MAX_LEVELS): DiscoveredContext[] {
    const results: DiscoveredContext[] = [];
    let currentDir = path.resolve(workPath);
    const root = path.parse(currentDir).root;

    for (let level = 0; level <= maxLevels; level++) {
        const found = findContextFile(currentDir);
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

function findContextFile(dir: string): string | null {
    for (const name of CONTEXT_FILE_NAMES) {
        const filePath = path.join(dir, name);
        try {
            if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return filePath;
        } catch { /* ignore */ }
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

        const result = detector.detect(content);
        if (result.severity === InjectionSeverity.BLOCK) return null;
        return { path: filePath, content: result.severity === InjectionSeverity.WARN ? result.sanitized : content, level };
    } catch {
        return null;
    }
}
