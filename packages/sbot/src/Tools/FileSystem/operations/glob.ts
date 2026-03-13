import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { checkDir } from '../utils';

const logger = LoggerService.getLogger('Tools/FileSystem/operations/glob.ts');

const LIMIT = 100;
const EXCLUDE_DIRS = new Set([
    'node_modules', '.git', '.svn', 'dist', 'build', 'out',
    '.cache', 'coverage', '__pycache__', '.next', '.nuxt', '.turbo', 'vendor',
]);

// ─── ripgrep 可用性检测（结果缓存）──────────────────────────────────────────
let rgAvailable: boolean | null = null;
function checkRg(): Promise<boolean> {
    if (rgAvailable !== null) return Promise.resolve(rgAvailable);
    return new Promise(resolve => {
        const proc = spawn('rg', ['--version'], { stdio: 'ignore' });
        proc.on('close', code => { rgAvailable = code === 0; resolve(rgAvailable!); });
        proc.on('error', () => { rgAvailable = false; resolve(false); });
    });
}

// ─── glob 模式 → RegExp（支持 ** / * / ?）────────────────────────────────────
function hasPathPattern(pattern: string): boolean {
    return pattern.includes('/') || pattern.includes('**');
}

function globToRegex(pattern: string): RegExp {
    let re = '';
    let i = 0;
    while (i < pattern.length) {
        if (pattern[i] === '*' && pattern[i + 1] === '*') {
            re += '.*';
            i += 2;
            if (pattern[i] === '/') i++;
        } else if (pattern[i] === '*') {
            re += '[^/]*';
            i++;
        } else if (pattern[i] === '?') {
            re += '[^/]';
            i++;
        } else {
            re += pattern[i].replace(/[.+^${}()|[\]\\]/g, '\\$&');
            i++;
        }
    }
    return new RegExp('^' + re + '$');
}

// ─── ripgrep 搜索（--files 模式）──────────────────────────────────────────────
function searchWithRg(dir: string, pattern: string, includeHidden: boolean): Promise<Array<{ path: string; mtime: number }>> {
    return new Promise((resolve, reject) => {
        const args = ['--files', '--glob=!.git/*', `--glob=${pattern}`];
        if (includeHidden) args.push('--hidden');
        args.push(dir);

        const proc = spawn('rg', args);
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
        proc.on('error', reject);
        proc.on('close', code => {
            if (code === 1) return resolve([]);
            if (code === 2 && !stdout.trim()) return reject(new Error(`ripgrep: ${stderr.trim()}`));
            const files: Array<{ path: string; mtime: number }> = [];
            for (const line of stdout.trim().split(/\r?\n/)) {
                if (!line) continue;
                let mtime = 0;
                try { mtime = fs.statSync(line).mtimeMs; } catch { /* skip */ }
                files.push({ path: line, mtime });
            }
            resolve(files);
        });
    });
}

// ─── Node.js fallback ─────────────────────────────────────────────────────────
function searchWithNodeJs(dir: string, pattern: string, includeHidden: boolean): Array<{ path: string; mtime: number }> {
    const useFullPath = hasPathPattern(pattern);
    const regex = globToRegex(pattern);
    const results: Array<{ path: string; mtime: number }> = [];

    function walk(d: string) {
        try {
            for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
                if (!includeHidden && entry.name.startsWith('.')) continue;
                const full = path.join(d, entry.name);
                if (entry.isDirectory()) {
                    if (EXCLUDE_DIRS.has(entry.name)) continue;
                    walk(full);
                } else if (entry.isFile()) {
                    const testStr = useFullPath
                        ? path.relative(dir, full).replace(/\\/g, '/')
                        : entry.name;
                    if (regex.test(testStr)) {
                        let mtime = 0;
                        try { mtime = fs.statSync(full).mtimeMs; } catch { /* skip */ }
                        results.push({ path: full, mtime });
                    }
                }
            }
        } catch (e: any) { logger.warn(`Cannot access ${d}: ${e.message}`); }
    }
    walk(dir);
    return results;
}

// ─── Tool 定义 ────────────────────────────────────────────────────────────────

/** 按 glob 模式查找文件（ripgrep 优先 + Node.js fallback；按修改时间排序） */
export function createGlobTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'glob',
        description: `Finds files matching a glob pattern (e.g. **/*.ts, src/**/*.test.js). Returns absolute paths sorted by most recently modified. Automatically skips node_modules, .git, dist, build, and other common build/vendor directories. Uses ripgrep when available. Path must be absolute.
Use grep_files to search by file content instead of name.`,
        schema: z.object({
            pattern: z.string().describe('Glob pattern, e.g. **/*.ts, src/**/*.test.js, *.json'),
            path: z.string().describe('Absolute path of the directory to search'),
            includeHidden: z.boolean().optional().default(false).describe('Include hidden files, default false'),
        }) as any,
        func: async ({ pattern, path: searchPath, includeHidden = false }: any): Promise<MCPToolResult> => {
            try {
                const abs = checkDir(searchPath);
                let files: Array<{ path: string; mtime: number }>;

                if (await checkRg()) {
                    files = await searchWithRg(abs, pattern, includeHidden);
                } else {
                    files = searchWithNodeJs(abs, pattern, includeHidden);
                }

                files.sort((a, b) => b.mtime - a.mtime);

                let truncated = false;
                if (files.length > LIMIT) {
                    files = files.slice(0, LIMIT);
                    truncated = true;
                }

                if (files.length === 0) return createSuccessResult(createTextContent('No files found'));

                const lines = files.map(f => f.path);
                if (truncated) {
                    lines.push('');
                    lines.push(`(Results are truncated: showing first ${LIMIT} results. Consider using a more specific path or pattern.)`);
                }
                return createSuccessResult(createTextContent(lines.join('\n')));
            } catch (e: any) {
                logger.error(`glob ${searchPath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        },
    });
}
