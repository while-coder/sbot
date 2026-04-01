import fs from 'fs';
import fsAsync from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { randomBytes } from 'crypto';

// ─── 默认跳过目录（等同于常见 .gitignore 规则）─────────────────────────────
export const EXCLUDE_DIRS = new Set([
    'node_modules', '.git', '.svn', 'dist', 'build', 'out',
    '.cache', 'coverage', '__pycache__', '.next', '.nuxt', '.turbo', 'vendor',
]);

// ─── ripgrep 可用性检测（结果缓存）──────────────────────────────────────────
let rgAvailable: boolean | null = null;

export function checkRg(): Promise<boolean> {
    if (rgAvailable !== null) return Promise.resolve(rgAvailable);
    return new Promise(resolve => {
        const proc = spawn('rg', ['--version'], { stdio: 'ignore' });
        proc.on('close', code => { rgAvailable = code === 0; resolve(rgAvailable!); });
        proc.on('error', () => { rgAvailable = false; resolve(false); });
    });
}

export function formatSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 B';
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return i === 0 ? `${bytes} B` : `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

export function normalizeLineEndings(text: string): string {
    return text.replace(/\r\n/g, '\n');
}

/** 将通配符模式转为正则 */
export function globToRegex(pattern: string): RegExp {
    return new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
}

/** 路径验证：非绝对路径时抛出异常 */
export function resolvePath(p: string): string {
    if (!path.isAbsolute(p)) throw new Error(`Path must be absolute: ${p}`);
    return path.normalize(p);
}

/** 验证并返回已存在文件的绝对路径和 stat，不满足时抛出 */
export function checkFile(filePath: string): { abs: string; stat: fs.Stats } {
    const abs = resolvePath(filePath);
    if (!fs.existsSync(abs)) throw new Error(`File not found: ${abs}`);
    const stat = fs.statSync(abs);
    if (!stat.isFile()) throw new Error(`Path is not a file: ${abs}`);
    return { abs, stat };
}

/** 验证并返回已存在目录的绝对路径，不满足时抛出 */
export function checkDir(dirPath: string): string {
    const abs = resolvePath(dirPath);
    if (!fs.existsSync(abs)) throw new Error(`Directory not found: ${abs}`);
    if (!fs.statSync(abs).isDirectory()) throw new Error(`Path is not a directory: ${abs}`);
    return abs;
}

/** 原子写入：先写临时文件再 rename，失败时清理临时文件 */
export async function writeAtomic(filePath: string, content: string, encoding: BufferEncoding): Promise<void> {
    const tmp = `${filePath}.${randomBytes(16).toString('hex')}.tmp`;
    try {
        await fsAsync.writeFile(tmp, content, encoding);
        await fsAsync.rename(tmp, filePath);
    } catch (e) {
        try { await fsAsync.unlink(tmp); } catch { /* ignore */ }
        throw e;
    }
}

