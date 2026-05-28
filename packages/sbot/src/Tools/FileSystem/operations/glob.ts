import fsAsync from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { checkDir, EXCLUDE_DIRS, checkRg } from '../utils';
import { loadPrompt } from '../../../Core/PromptLoader';

const logger = LoggerService.getLogger('Tools/FileSystem/operations/glob.ts');

const LIMIT = 100;
const DEFAULT_TIMEOUT_SEC = 30;

interface GlobSearchResult { files: Array<{ path: string; mtime: number }>; truncated: boolean; }

// rg 默认排除目录（gitignore 语法）
const RG_EXCLUDE_ARGS = [...EXCLUDE_DIRS].map(d => `--glob=!${d}`);

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
    return new RegExp('^' + re + '$', 'i');
}

// ─── ripgrep 搜索（流式 + 达到上限即终止）──────────────────────────────────
function searchWithRg(dir: string, pattern: string, includeHidden: boolean, timeoutMs: number): Promise<GlobSearchResult> {
    return new Promise((resolve, reject) => {
        const args = ['--files', ...RG_EXCLUDE_ARGS, `--iglob=${pattern}`];
        if (includeHidden) args.push('--hidden');
        args.push(dir);

        const proc = spawn('rg', args);
        const files: Array<{ path: string; mtime: number }> = [];
        let killed = false;
        let timedOut = false;
        let buffer = '';
        let stderr = '';
        let pending = 0;
        let submitted = 0;
        let closed = false;
        let exitCode: number | null = null;

        const stop = (timeout = false) => {
            if (killed) return;
            killed = true;
            if (timeout) timedOut = true;
            try { proc.kill('SIGTERM'); } catch { /* ignore */ }
        };

        const timer = setTimeout(() => stop(true), timeoutMs);

        const tryResolve = () => {
            if (closed && pending === 0) {
                if (!killed && exitCode !== 0 && exitCode !== 1 && files.length === 0) {
                    return reject(new Error(`ripgrep: ${stderr.trim() || `exit ${exitCode}`}`));
                }
                if (timedOut) logger.warn(`ripgrep glob timed out after ${timeoutMs}ms; returning ${files.length} files`);
                resolve({ files, truncated: timedOut });
            }
        };

        const processLine = (line: string): boolean => {
            if (!line || killed) return !killed;
            if (submitted >= LIMIT) return false;
            submitted++;
            pending++;
            fsAsync.stat(line)
                .then(s => { files.push({ path: line, mtime: s.mtimeMs }); })
                .catch(() => { files.push({ path: line, mtime: 0 }); })
                .finally(() => { pending--; tryResolve(); });
            return submitted < LIMIT;
        };

        proc.stdout.on('data', (d: Buffer) => {
            if (killed) return;
            buffer += d.toString();
            let idx;
            while ((idx = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, idx).replace(/\r$/, '');
                buffer = buffer.slice(idx + 1);
                if (!processLine(line)) { stop(); return; }
            }
        });
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
        proc.on('error', e => { clearTimeout(timer); reject(e); });
        proc.on('close', code => {
            clearTimeout(timer);
            if (!killed && buffer) processLine(buffer.replace(/\r$/, ''));
            closed = true;
            exitCode = code;
            tryResolve();
        });
    });
}

// ─── Node.js fallback（全异步，避免阻塞事件循环）────────────────────────────
async function searchWithNodeJs(dir: string, pattern: string, includeHidden: boolean, timeoutMs: number): Promise<GlobSearchResult> {
    const useFullPath = hasPathPattern(pattern);
    const regex = globToRegex(pattern);
    const results: Array<{ path: string; mtime: number }> = [];
    const deadline = Date.now() + timeoutMs;
    const expired = () => Date.now() >= deadline;

    async function walk(d: string): Promise<boolean> {
        if (expired()) return false;
        let entries;
        try { entries = await fsAsync.readdir(d, { withFileTypes: true }); }
        catch (e: any) { logger.warn(`Cannot access ${d}: ${e.message}`); return true; }
        for (const entry of entries) {
            if (results.length >= LIMIT || expired()) return false;
            if (!includeHidden && entry.name.startsWith('.')) continue;
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) {
                if (EXCLUDE_DIRS.has(entry.name)) continue;
                if (!await walk(full)) return false;
            } else if (entry.isFile()) {
                const testStr = useFullPath
                    ? path.relative(dir, full).replace(/\\/g, '/')
                    : entry.name;
                if (regex.test(testStr)) {
                    let mtime = 0;
                    try { mtime = (await fsAsync.stat(full)).mtimeMs; } catch { /* skip */ }
                    results.push({ path: full, mtime });
                }
            }
        }
        return true;
    }
    await walk(dir);
    const timedOut = expired();
    if (timedOut) logger.warn(`Node.js glob timed out after ${timeoutMs}ms; returning ${results.length} files`);
    return { files: results, truncated: timedOut };
}

// ─── Tool 定义 ────────────────────────────────────────────────────────────────

/** 按 glob 模式查找文件（ripgrep 优先 + Node.js fallback；按修改时间排序） */
export function createGlobTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'glob',
        description: loadPrompt('tools/fs/glob.txt'),
        schema: z.object({
            pattern: z.string().describe('Glob pattern, e.g. **/*.ts, src/**/*.test.js, *.json'),
            path: z.string().describe('Absolute path of the directory to search'),
            includeHidden: z.boolean().optional().default(false).describe('Include hidden files, default false'),
            timeoutSec: z.number().positive().optional().default(DEFAULT_TIMEOUT_SEC).describe(`Search timeout in seconds; on timeout returns partial results marked truncated. Default ${DEFAULT_TIMEOUT_SEC}`),
        }) as any,
        func: async ({ pattern, path: searchPath, includeHidden = false, timeoutSec = DEFAULT_TIMEOUT_SEC }: any): Promise<MCPToolResult> => {
            try {
                const abs = checkDir(searchPath);
                const timeoutMs = Math.round(timeoutSec * 1000);
                const search = await checkRg()
                    ? await searchWithRg(abs, pattern, includeHidden, timeoutMs)
                    : await searchWithNodeJs(abs, pattern, includeHidden, timeoutMs);
                let files = search.files;
                let truncated = search.truncated;

                files.sort((a, b) => b.mtime - a.mtime);

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
