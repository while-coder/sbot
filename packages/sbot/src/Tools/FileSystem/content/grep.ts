import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { FileSystemToolsConfig } from '../config';
import { checkDir, globToRegex } from '../utils';

const logger = LoggerService.getLogger('Tools/FileSystem/content/grep.ts');

const MAX_LINE_LENGTH = 2000;
const DEFAULT_MAX_MATCHES = 100;

// ─── 默认跳过目录（等同于常见 .gitignore 规则）─────────────────────────────
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

// ─── 类型 ─────────────────────────────────────────────────────────────────────
interface MatchLine { lineNum: number; text: string; }
interface FileMatches { filePath: string; mtime: number; matches: MatchLine[]; }
interface SearchResult { results: FileMatches[]; reachedLimit: boolean; }

// ─── ripgrep 搜索（--json 模式）──────────────────────────────────────────────
function searchWithRg(
    dir: string,
    pattern: string,
    useRegex: boolean,
    caseSensitive: boolean,
    includeHidden: boolean,
    fileGlob: string | undefined,
    maxMatches: number,
): Promise<SearchResult> {
    return new Promise((resolve, reject) => {
        const args = ['--json', '--glob=!.git/*'];
        if (!caseSensitive) args.push('--ignore-case');
        if (!useRegex) args.push('--fixed-strings');
        if (includeHidden) args.push('--hidden');
        if (fileGlob) args.push(`--glob=${fileGlob}`);
        args.push('--', pattern, dir);

        const proc = spawn('rg', args);
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
        proc.on('error', reject);
        proc.on('close', code => {
            if (code === 1) return resolve({ results: [], reachedLimit: false });
            if (code === 2 && !stdout.trim()) return reject(new Error(`ripgrep: ${stderr.trim()}`));

            const byFile = new Map<string, FileMatches>();
            const fileOrder: string[] = [];
            let totalMatches = 0;
            let reachedLimit = false;

            for (const line of stdout.trim().split(/\r?\n/)) {
                if (!line) continue;
                let parsed: any;
                try { parsed = JSON.parse(line); } catch { continue; }
                if (parsed.type !== 'match') continue;
                if (totalMatches >= maxMatches) { reachedLimit = true; break; }

                const fp: string = parsed.data.path.text;
                const lineNum: number = parsed.data.line_number;
                const raw: string = parsed.data.lines.text.replace(/\r?\n$/, '');
                const text = raw.length > MAX_LINE_LENGTH ? raw.slice(0, MAX_LINE_LENGTH) + '...' : raw;

                if (!byFile.has(fp)) {
                    let mtime = 0;
                    try { mtime = fs.statSync(fp).mtimeMs; } catch { /* */ }
                    byFile.set(fp, { filePath: fp, mtime, matches: [] });
                    fileOrder.push(fp);
                }
                byFile.get(fp)!.matches.push({ lineNum, text });
                totalMatches++;
            }

            const results = fileOrder.map(fp => byFile.get(fp)!);
            results.sort((a, b) => b.mtime - a.mtime);
            resolve({ results, reachedLimit });
        });
    });
}

// ─── Node.js fallback ─────────────────────────────────────────────────────────
function isBinary(fp: string): boolean {
    try {
        const buf = Buffer.alloc(512);
        const fd = fs.openSync(fp, 'r');
        const read = fs.readSync(fd, buf, 0, 512, 0);
        fs.closeSync(fd);
        return buf.subarray(0, read).includes(0);
    } catch { return true; }
}

function searchWithNodeJs(
    dir: string,
    pattern: string,
    fileRegex: RegExp,
    useRegex: boolean,
    caseSensitive: boolean,
    includeHidden: boolean,
    maxFileSize: number,
    maxMatches: number,
): SearchResult {
    const searchRegex = useRegex ? new RegExp(pattern, caseSensitive ? '' : 'i') : null;
    const searchLower = caseSensitive ? pattern : pattern.toLowerCase();

    const allFiles: Array<{ path: string; mtime: number }> = [];
    function walk(d: string) {
        try {
            for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
                if (!includeHidden && entry.name.startsWith('.')) continue;
                const full = path.join(d, entry.name);
                if (entry.isDirectory()) {
                    if (EXCLUDE_DIRS.has(entry.name)) continue;
                    walk(full);
                } else if (entry.isFile() && fileRegex.test(entry.name)) {
                    try {
                        const stat = fs.statSync(full);
                        if (stat.size <= maxFileSize) allFiles.push({ path: full, mtime: stat.mtimeMs });
                    } catch { /* skip */ }
                }
            }
        } catch (e: any) { logger.warn(`Cannot access ${d}: ${e.message}`); }
    }
    walk(dir);
    allFiles.sort((a, b) => b.mtime - a.mtime);

    const results: FileMatches[] = [];
    let totalMatches = 0;
    let reachedLimit = false;

    outer: for (const { path: fp, mtime } of allFiles) {
        if (isBinary(fp)) continue;
        try {
            const fileMatches: MatchLine[] = [];
            const lines = fs.readFileSync(fp, 'utf8').split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const hit = searchRegex
                    ? searchRegex.test(line)
                    : (caseSensitive ? line : line.toLowerCase()).includes(searchLower);
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
export function createGrepFilesTool(config: FileSystemToolsConfig = { maxFileSize: 10 * 1024 * 1024 }): StructuredToolInterface {
    const maxFileSize = config.maxFileSize;
    return new DynamicStructuredTool({
        name: 'grep_files',
        description: `Searches for text or regex across files in a directory (always recursive). Automatically skips node_modules, .git, dist, build, and other common build/vendor directories. Results sorted by most recently modified file. Uses ripgrep when available, falls back to Node.js. Paths must be absolute.
Use search_files to find files by name pattern instead of content.`,
        schema: z.object({
            searchPath: z.string().describe('搜索目录的绝对路径'),
            searchText: z.string().describe('要搜索的文本；useRegex=true 时为正则表达式'),
            filePattern: z.string().optional().describe('文件名过滤模式（如 *.ts），默认所有文件'),
            useRegex: z.boolean().optional().default(false).describe('将 searchText 作为正则表达式，默认 false（字面量搜索）'),
            caseSensitive: z.boolean().optional().default(true).describe('是否区分大小写，默认 true'),
            includeHidden: z.boolean().optional().default(false).describe('是否包含隐藏文件（.开头），默认 false'),
            maxMatches: z.number().optional().default(DEFAULT_MAX_MATCHES).describe('最大匹配行数（跨所有文件合计），默认 100'),
        }) as any,
        func: async ({ searchPath, searchText, filePattern, useRegex = false, caseSensitive = true, includeHidden = false, maxMatches = DEFAULT_MAX_MATCHES }: any): Promise<MCPToolResult> => {
            try {
                const abs = checkDir(searchPath);
                let result: SearchResult;

                if (await checkRg()) {
                    result = await searchWithRg(abs, searchText, useRegex, caseSensitive, includeHidden, filePattern, maxMatches);
                } else {
                    const fileRegex = globToRegex(filePattern ?? '*');
                    result = searchWithNodeJs(abs, searchText, fileRegex, useRegex, caseSensitive, includeHidden, maxFileSize, maxMatches);
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
