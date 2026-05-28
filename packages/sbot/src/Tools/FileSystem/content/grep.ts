import fs from 'fs';
import fsAsync, { type FileHandle } from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { checkDir, globToRegex, EXCLUDE_DIRS, checkRg } from '../utils';
import { loadPrompt } from '../../../Core/PromptLoader';

const logger = LoggerService.getLogger('Tools/FileSystem/content/grep.ts');

const MAX_LINE_LENGTH = 2000;
const DEFAULT_MAX_MATCHES = 100;
const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1MB - skip large files in Node.js fallback
const MAX_COLUMNS = 4096;
const DEFAULT_TIMEOUT_SEC = 30;

// ─── 类型 ─────────────────────────────────────────────────────────────────────
interface MatchLine { lineNum: number; text: string; }
interface FileMatches { filePath: string; mtime: number; matches: MatchLine[]; }
interface SearchResult { results: FileMatches[]; reachedLimit: boolean; }

// rg 默认排除目录（gitignore 语法，无 / 时匹配任意层级）
const RG_EXCLUDE_ARGS = [...EXCLUDE_DIRS].map(d => `--glob=!${d}`);

// ─── ripgrep 搜索（--json 流式 + 达到上限即终止）────────────────────────────
function searchWithRg(
    dir: string,
    pattern: string,
    useRegex: boolean,
    includeHidden: boolean,
    fileGlob: string | undefined,
    maxMatches: number,
    timeoutMs: number,
): Promise<SearchResult> {
    return new Promise((resolve, reject) => {
        const args = ['--json', `--max-columns=${MAX_COLUMNS}`, ...RG_EXCLUDE_ARGS];
        if (!useRegex) args.push('--fixed-strings');
        if (includeHidden) args.push('--hidden');
        if (fileGlob) args.push(`--iglob=${fileGlob}`);
        args.push('--', pattern, dir);

        const proc = spawn('rg', args);
        const byFile = new Map<string, FileMatches>();
        const fileOrder: string[] = [];
        let totalMatches = 0;
        let reachedLimit = false;
        let timedOut = false;
        let killed = false;
        let buffer = '';
        let stderr = '';

        const stop = (limit: boolean, timeout = false) => {
            if (killed) return;
            killed = true;
            if (limit) reachedLimit = true;
            if (timeout) timedOut = true;
            try { proc.kill('SIGTERM'); } catch { /* ignore */ }
        };

        const timer = setTimeout(() => stop(true, true), timeoutMs);

        const processLine = (line: string): boolean => {
            if (!line) return true;
            let parsed: any;
            try { parsed = JSON.parse(line); } catch { return true; }
            if (parsed.type !== 'match') return true;

            const fp: string = parsed.data.path.text;
            const lineNum: number = parsed.data.line_number;
            const raw: string = (parsed.data.lines?.text ?? '').replace(/\r?\n$/, '');
            const text = raw.length > MAX_LINE_LENGTH ? raw.slice(0, MAX_LINE_LENGTH) + '...' : raw;

            if (!byFile.has(fp)) {
                let mtime = 0;
                try { mtime = fs.statSync(fp).mtimeMs; } catch { /* */ }
                byFile.set(fp, { filePath: fp, mtime, matches: [] });
                fileOrder.push(fp);
            }
            byFile.get(fp)!.matches.push({ lineNum, text });
            totalMatches++;
            return totalMatches < maxMatches;
        };

        proc.stdout.on('data', (d: Buffer) => {
            if (killed) return;
            buffer += d.toString();
            let idx;
            while ((idx = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, idx).replace(/\r$/, '');
                buffer = buffer.slice(idx + 1);
                if (!processLine(line)) { stop(true); return; }
            }
            // 防御：单行过长时丢弃
            if (buffer.length > 10 * MAX_COLUMNS) buffer = '';
        });
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
        proc.on('error', e => { clearTimeout(timer); reject(e); });
        proc.on('close', code => {
            clearTimeout(timer);
            if (!killed && buffer) processLine(buffer.replace(/\r$/, ''));
            // code 1 = 无匹配；被 kill 时 code/signal 不可靠，按 totalMatches 判断
            if (!killed && code !== 0 && code !== 1 && totalMatches === 0) {
                return reject(new Error(`ripgrep: ${stderr.trim() || `exit ${code}`}`));
            }
            if (timedOut) logger.warn(`ripgrep timed out after ${timeoutMs}ms; returning ${totalMatches} matches`);
            const results = fileOrder.map(fp => byFile.get(fp)!);
            results.sort((a, b) => b.mtime - a.mtime);
            resolve({ results, reachedLimit });
        });
    });
}

// ─── Node.js fallback（全异步，避免阻塞事件循环）────────────────────────────
async function isBinaryAsync(fp: string): Promise<boolean> {
    let fh: FileHandle | undefined;
    try {
        fh = await fsAsync.open(fp, 'r');
        const buf = Buffer.alloc(512);
        const { bytesRead } = await fh.read(buf, 0, 512, 0);
        return buf.subarray(0, bytesRead).includes(0);
    } catch { return true; }
    finally { try { await fh?.close(); } catch { /* ignore */ } }
}

async function searchWithNodeJs(
    dir: string,
    pattern: string,
    fileRegex: RegExp,
    useRegex: boolean,
    includeHidden: boolean,
    maxFileSize: number,
    maxMatches: number,
    timeoutMs: number,
): Promise<SearchResult> {
    const searchRegex = useRegex ? new RegExp(pattern) : null;
    const deadline = Date.now() + timeoutMs;
    const expired = () => Date.now() >= deadline;

    const allFiles: Array<{ path: string; mtime: number }> = [];
    async function walk(d: string): Promise<void> {
        if (expired()) return;
        let entries;
        try { entries = await fsAsync.readdir(d, { withFileTypes: true }); }
        catch (e: any) { logger.warn(`Cannot access ${d}: ${e.message}`); return; }
        for (const entry of entries) {
            if (expired()) return;
            if (!includeHidden && entry.name.startsWith('.')) continue;
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) {
                if (EXCLUDE_DIRS.has(entry.name)) continue;
                await walk(full);
            } else if (entry.isFile() && fileRegex.test(entry.name)) {
                try {
                    const stat = await fsAsync.stat(full);
                    if (stat.size <= maxFileSize) allFiles.push({ path: full, mtime: stat.mtimeMs });
                } catch { /* skip */ }
            }
        }
    }
    await walk(dir);
    allFiles.sort((a, b) => b.mtime - a.mtime);

    const results: FileMatches[] = [];
    let totalMatches = 0;
    let reachedLimit = false;

    outer: for (const { path: fp, mtime } of allFiles) {
        if (expired()) { reachedLimit = true; break; }
        if (await isBinaryAsync(fp)) continue;
        try {
            const fileMatches: MatchLine[] = [];
            const content = await fsAsync.readFile(fp, 'utf8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const hit = searchRegex ? searchRegex.test(line) : line.includes(pattern);
                if (!hit) continue;
                const text = line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) + '...' : line;
                fileMatches.push({ lineNum: i + 1, text });
                if (++totalMatches >= maxMatches) {
                    results.push({ filePath: fp, mtime, matches: fileMatches });
                    reachedLimit = true;
                    break outer;
                }
            }
            if (fileMatches.length > 0) results.push({ filePath: fp, mtime, matches: fileMatches });
        } catch { /* skip unreadable */ }
    }

    if (expired() && !reachedLimit) reachedLimit = true;
    if (Date.now() >= deadline) logger.warn(`Node.js grep timed out after ${timeoutMs}ms; returning ${totalMatches} matches`);
    return { results, reachedLimit };
}

// ─── 输出格式化 ───────────────────────────────────────────────────────────────
function formatResults(results: FileMatches[], reachedLimit: boolean, maxMatches: number): string {
    const total = results.reduce((s, r) => s + r.matches.length, 0);
    const lines: string[] = [
        `Found ${total}${reachedLimit ? '+' : ''} matches${reachedLimit ? ` (showing first ${maxMatches})` : ''}`,
    ];
    for (const r of results) {
        lines.push('');
        lines.push(`${r.filePath}:`);
        for (const m of r.matches) lines.push(`  Line ${m.lineNum}: ${m.text}`);
    }
    if (reachedLimit) {
        lines.push('');
        lines.push(`(Truncated at ${maxMatches} matches. Use a more specific pattern or path.)`);
    }
    return lines.join('\n');
}

// ─── Tool 定义 ────────────────────────────────────────────────────────────────

/** 跨文件内容搜索（ripgrep 优先 + Node.js fallback；跳过构建目录；按修改时间排序）*/
export function createGrepFilesTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'grep',
        description: loadPrompt('tools/fs/grep.txt'),
        schema: z.object({
            path: z.string().describe('Absolute path of the directory to search'),
            pattern: z.string().describe('Text to search for; treated as a regex when useRegex=true'),
            glob: z.string().optional().describe('File name filter pattern (e.g. *.ts), default all files'),
            useRegex: z.boolean().optional().default(false).describe('Treat pattern as a regex, default false (literal search)'),
            includeHidden: z.boolean().optional().default(false).describe('Include hidden files (starting with .), default false'),
            maxMatches: z.number().optional().default(DEFAULT_MAX_MATCHES).describe('Maximum number of matching lines across all files, default 100'),
            timeoutSec: z.number().positive().optional().default(DEFAULT_TIMEOUT_SEC).describe(`Search timeout in seconds; on timeout returns partial results marked truncated. Default ${DEFAULT_TIMEOUT_SEC}`),
        }) as any,
        func: async ({ path: searchPath, pattern, glob, useRegex = false, includeHidden = false, maxMatches = DEFAULT_MAX_MATCHES, timeoutSec = DEFAULT_TIMEOUT_SEC }: any): Promise<MCPToolResult> => {
            try {
                const abs = checkDir(searchPath);
                const timeoutMs = Math.round(timeoutSec * 1000);
                let result: SearchResult;

                if (await checkRg()) {
                    result = await searchWithRg(abs, pattern, useRegex, includeHidden, glob, maxMatches, timeoutMs);
                } else {
                    const fileRegex = globToRegex(glob ?? '*');
                    result = await searchWithNodeJs(abs, pattern, fileRegex, useRegex, includeHidden, MAX_FILE_SIZE, maxMatches, timeoutMs);
                }

                if (result.results.length === 0) return createSuccessResult(createTextContent('No matches found'));
                return createSuccessResult(createTextContent(formatResults(result.results, result.reachedLimit, maxMatches)));
            } catch (e: any) {
                logger.error(`grep_files ${searchPath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}
