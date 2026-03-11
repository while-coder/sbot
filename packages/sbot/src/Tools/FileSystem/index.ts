/**
 * 文件系统工具集
 * 为 LLM 提供方便的本地文件读写操作能力
 * 注意：所有路径参数必须使用绝对路径
 */

import fs from 'fs';
import fsAsync from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';
import { createTwoFilesPatch } from 'diff';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { FileSystemToolsConfig } from './config';

const logger = LoggerService.getLogger('Tools/FileSystem/index.ts');

export type { FileSystemToolsConfig } from './config';

// ── Utility Functions ──────────────────────────────────────────────────────────

export function formatSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 B';
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return i === 0 ? `${bytes} B` : `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

function normalizeLineEndings(text: string): string {
    return text.replace(/\r\n/g, '\n');
}

/** 将通配符模式转为正则 */
function globToRegex(pattern: string): RegExp {
    return new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
}

/** 路径验证：非绝对路径时抛出异常 */
function resolvePath(p: string): string {
    if (!path.isAbsolute(p)) throw new Error(`路径必须是绝对路径: ${p}`);
    return path.normalize(p);
}

/** 验证并返回已存在文件的绝对路径和 stat，不满足时抛出 */
function checkFile(filePath: string): { abs: string; stat: fs.Stats } {
    const abs = resolvePath(filePath);
    if (!fs.existsSync(abs)) throw new Error(`文件不存在: ${abs}`);
    const stat = fs.statSync(abs);
    if (!stat.isFile()) throw new Error(`路径不是文件: ${abs}`);
    return { abs, stat };
}

/** 验证并返回已存在目录的绝对路径，不满足时抛出 */
function checkDir(dirPath: string): string {
    const abs = resolvePath(dirPath);
    if (!fs.existsSync(abs)) throw new Error(`目录不存在: ${abs}`);
    if (!fs.statSync(abs).isDirectory()) throw new Error(`路径不是目录: ${abs}`);
    return abs;
}

/** 原子写入：先写临时文件再 rename，失败时清理临时文件 */
async function writeAtomic(filePath: string, content: string, encoding: BufferEncoding): Promise<void> {
    const tmp = `${filePath}.${randomBytes(16).toString('hex')}.tmp`;
    try {
        await fsAsync.writeFile(tmp, content, encoding);
        await fsAsync.rename(tmp, filePath);
    } catch (e) {
        try { await fsAsync.unlink(tmp); } catch { /* ignore */ }
        throw e;
    }
}

/** 内存高效的 tail：从文件末尾读取 N 行（1KB 分块）*/
async function tailFile(filePath: string, numLines: number): Promise<string> {
    const CHUNK = 1024;
    const stats = await fsAsync.stat(filePath);
    if (stats.size === 0) return '';
    const fh = await fsAsync.open(filePath, 'r');
    try {
        const lines: string[] = [];
        let position = stats.size;
        const buf = Buffer.alloc(CHUNK);
        let linesFound = 0;
        let remaining = '';
        while (position > 0 && linesFound < numLines) {
            const size = Math.min(CHUNK, position);
            position -= size;
            const { bytesRead } = await fh.read(buf, 0, size, position);
            if (!bytesRead) break;
            // 先 normalize 再拼接 remaining，避免 chunk 内部出现 \r\n 未处理
            const chunk = normalizeLineEndings(buf.slice(0, bytesRead).toString('utf-8')) + remaining;
            const parts = chunk.split('\n');
            if (position > 0) remaining = parts.shift()!;
            for (let i = parts.length - 1; i >= 0 && linesFound < numLines; i--) {
                lines.unshift(parts[i]);
                linesFound++;
            }
        }
        return lines.join('\n');
    } finally {
        await fh.close();
    }
}

/** 内存高效的 head：从文件头读取 N 行 */
async function headFile(filePath: string, numLines: number): Promise<string> {
    const fh = await fsAsync.open(filePath, 'r');
    try {
        const lines: string[] = [];
        let buffer = '';
        let offset = 0;
        const chunk = Buffer.alloc(1024);
        while (lines.length < numLines) {
            const { bytesRead } = await fh.read(chunk, 0, chunk.length, offset);
            if (bytesRead === 0) break;
            offset += bytesRead;
            // normalize 后再拼接，避免跨 chunk 的 \r\n 在拼完后被遗漏
            buffer += normalizeLineEndings(chunk.subarray(0, bytesRead).toString('utf-8'));
            const nl = buffer.lastIndexOf('\n');
            if (nl !== -1) {
                const complete = buffer.slice(0, nl).split('\n');
                buffer = buffer.slice(nl + 1);
                for (const line of complete) {
                    lines.push(line);
                    if (lines.length >= numLines) break;
                }
            }
        }
        if (buffer.length > 0 && lines.length < numLines) lines.push(buffer);
        return lines.join('\n');
    } finally {
        await fh.close();
    }
}

interface FileEdit { oldText: string; newText: string; useRegex?: boolean; regexFlags?: string; }

/** 按 oldText→newText 对文件做多处修改，支持模糊空白匹配和正则替换，返回 unified diff */
async function applyFileEdits(filePath: string, edits: FileEdit[], dryRun = false): Promise<string> {
    const content = normalizeLineEndings(await fsAsync.readFile(filePath, 'utf-8'));
    let modified = content;
    for (const edit of edits) {
        const newN = normalizeLineEndings(edit.newText);
        if (edit.useRegex) {
            const regex = new RegExp(edit.oldText, edit.regexFlags ?? 'g');
            if (!modified.match(regex)) throw new Error(`正则表达式无匹配: ${edit.oldText}`);
            modified = modified.replace(regex, newN);
            continue;
        }
        const oldN = normalizeLineEndings(edit.oldText);
        if (modified.includes(oldN)) {
            modified = modified.replace(oldN, newN);
            continue;
        }
        // 按行模糊匹配（忽略行首尾空白）
        const oldLines = oldN.split('\n');
        const contentLines = modified.split('\n');
        let matched = false;
        for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
            if (!oldLines.every((ol, j) => ol.trim() === contentLines[i + j].trim())) continue;
            const origIndent = contentLines[i].match(/^\s*/)?.[0] ?? '';
            const newLines = newN.split('\n').map((line, j) => {
                if (j === 0) return origIndent + line.trimStart();
                const oldIndent = oldLines[j]?.match(/^\s*/)?.[0] ?? '';
                const ni = line.match(/^\s*/)?.[0] ?? '';
                if (oldIndent && ni) {
                    return origIndent + ' '.repeat(Math.max(0, ni.length - oldIndent.length)) + line.trimStart();
                }
                return line;
            });
            contentLines.splice(i, oldLines.length, ...newLines);
            modified = contentLines.join('\n');
            matched = true;
            break;
        }
        if (!matched) throw new Error(`找不到匹配的文本:\n${edit.oldText}`);
    }
    const diff = createTwoFilesPatch(filePath, filePath, content, modified, 'original', 'modified');
    let ticks = 3;
    while (diff.includes('`'.repeat(ticks))) ticks++;
    const formatted = `${'`'.repeat(ticks)}diff\n${diff}${'`'.repeat(ticks)}\n\n`;
    if (!dryRun) await writeAtomic(filePath, modified, 'utf-8');
    return formatted;
}

// ── Tools ──────────────────────────────────────────────────────────────────────

/** 读取文件内容（支持 head/tail 大文件截取）*/
export function createReadFileTool(config: FileSystemToolsConfig = { maxFileSize: 10 * 1024 * 1024 }): StructuredToolInterface {
    const maxSize = config.maxFileSize;
    return new DynamicStructuredTool({
        name: 'read_file',
        description: '读取本地文件的内容。支持 head/tail 参数截取大文件的前 N 行或后 N 行，避免超出大小限制。路径必须是绝对路径。',
        schema: z.object({
            filePath: z.string().describe('要读取的文件的绝对路径'),
            encoding: z.enum(['utf8', 'utf-8', 'ascii', 'base64']).optional().default('utf8').describe('文件编码，默认 utf8'),
            head: z.number().int().positive().optional().describe('只读取前 N 行（大文件截取）'),
            tail: z.number().int().positive().optional().describe('只读取后 N 行（大文件截取）'),
        }) as any,
        func: async ({ filePath, encoding = 'utf8', head, tail }: any): Promise<MCPToolResult> => {
            try {
                const { abs, stat } = checkFile(filePath);
                if (head) return createSuccessResult(createTextContent(await headFile(abs, head)));
                if (tail) return createSuccessResult(createTextContent(await tailFile(abs, tail)));
                if (stat.size > maxSize) {
                    return createErrorResult(`文件过大: ${formatSize(stat.size)}（限制: ${formatSize(maxSize)}），可使用 head/tail 参数截取`);
                }
                return createSuccessResult(createTextContent(fs.readFileSync(abs, encoding as BufferEncoding).toString()));
            } catch (e: any) {
                logger.error(`read_file ${filePath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}

/** 读取文件指定行范围 */
export function createReadFileLinesTool(config: FileSystemToolsConfig = { maxFileSize: 10 * 1024 * 1024 }): StructuredToolInterface {
    const maxSize = config.maxFileSize;
    return new DynamicStructuredTool({
        name: 'read_file_lines',
        description: '读取文件的指定行范围。行号从 1 开始。路径必须是绝对路径。',
        schema: z.object({
            filePath: z.string().describe('文件的绝对路径'),
            startLine: z.number().min(1).describe('起始行号（从 1 开始）'),
            endLine: z.number().min(1).optional().describe('结束行号（可选，不指定则读到末尾）'),
            encoding: z.enum(['utf8', 'utf-8', 'ascii']).optional().default('utf8').describe('文件编码'),
        }) as any,
        func: async ({ filePath, startLine, endLine, encoding = 'utf8' }: any): Promise<MCPToolResult> => {
            try {
                const { abs, stat } = checkFile(filePath);
                if (stat.size > maxSize) return createErrorResult(`文件过大: ${formatSize(stat.size)}`);
                const lines = fs.readFileSync(abs, encoding as BufferEncoding).toString().split('\n');
                if (startLine > lines.length) return createErrorResult(`起始行号 ${startLine} 超出文件总行数 ${lines.length}`);
                return createSuccessResult(createTextContent(lines.slice(startLine - 1, endLine ?? lines.length).join('\n')));
            } catch (e: any) {
                logger.error(`read_file_lines ${filePath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}

/** 读取媒体文件（图片/音频）为 base64 */
export function createReadMediaFileTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'read_media_file',
        description: '读取图片、音频等二进制文件，以 base64 格式返回内容。路径必须是绝对路径。',
        schema: z.object({
            filePath: z.string().describe('媒体文件的绝对路径'),
        }) as any,
        func: async ({ filePath }: any): Promise<MCPToolResult> => {
            try {
                const { abs, stat } = checkFile(filePath);
                const base64 = (await fsAsync.readFile(abs)).toString('base64');
                const ext = path.extname(abs).toLowerCase().slice(1);
                return createSuccessResult(createTextContent(JSON.stringify({ filePath: abs, size: formatSize(stat.size), ext, base64 })));
            } catch (e: any) {
                logger.error(`read_media_file ${filePath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}

/** 写入文件（原子替换，防止竞态条件）*/
export function createWriteFileTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'write_file',
        description: '写入内容到文件。文件不存在时自动创建；使用原子替换（temp+rename）保证写入安全。路径必须是绝对路径。',
        schema: z.object({
            filePath: z.string().describe('要写入的文件的绝对路径'),
            content: z.string().describe('要写入的文件内容'),
            encoding: z.enum(['utf8', 'utf-8', 'ascii']).optional().default('utf8').describe('文件编码，默认 utf8'),
            createDirs: z.boolean().optional().default(true).describe('目录不存在时是否自动创建，默认 true'),
        }) as any,
        func: async ({ filePath, content, encoding = 'utf8', createDirs = true }: any): Promise<MCPToolResult> => {
            try {
                const abs = resolvePath(filePath);
                const dir = path.dirname(abs);
                if (createDirs && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                await writeAtomic(abs, content, encoding as BufferEncoding);
                return createSuccessResult(createTextContent(`文件写入成功: ${abs}`));
            } catch (e: any) {
                logger.error(`write_file ${filePath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}

/** 精确文本编辑（支持多处替换 + 模糊空白匹配 + 正则 + unified diff 输出）*/
export function createEditFileTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'edit_file',
        description: '对文件进行精确的文本替换编辑。支持多处修改、正则替换（useRegex）、模糊空白匹配、dry-run 预览，返回 unified diff。路径必须是绝对路径。',
        schema: z.object({
            filePath: z.string().describe('要编辑的文件的绝对路径'),
            edits: z.array(z.object({
                oldText: z.string().describe('要替换的原始文本；useRegex=true 时为正则表达式模式'),
                newText: z.string().describe('替换后的新文本'),
                useRegex: z.boolean().optional().default(false).describe('将 oldText 作为正则表达式，默认 false'),
                regexFlags: z.string().optional().default('g').describe('正则标志，默认 g（全局替换），仅 useRegex=true 时生效'),
            })).describe('编辑操作列表，按顺序依次应用'),
            dryRun: z.boolean().optional().default(false).describe('仅预览 diff，不实际写入文件，默认 false'),
        }) as any,
        func: async ({ filePath, edits, dryRun = false }: any): Promise<MCPToolResult> => {
            try {
                const { abs } = checkFile(filePath);
                return createSuccessResult(createTextContent(await applyFileEdits(abs, edits, dryRun)));
            } catch (e: any) {
                logger.error(`edit_file ${filePath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}

/** 追加内容到文件末尾 */
export function createAppendFileTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'append_file',
        description: '追加内容到文件末尾。文件不存在时自动创建。路径必须是绝对路径。',
        schema: z.object({
            filePath: z.string().describe('要追加的文件的绝对路径'),
            content: z.string().describe('要追加的内容'),
            encoding: z.enum(['utf8', 'utf-8', 'ascii']).optional().default('utf8').describe('文件编码'),
            newLine: z.boolean().optional().default(true).describe('追加前是否自动添加换行符，默认 true'),
        }) as any,
        func: async ({ filePath, content, encoding = 'utf8', newLine = true }: any): Promise<MCPToolResult> => {
            try {
                const abs = resolvePath(filePath);
                const dir = path.dirname(abs);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                const toAppend = (fs.existsSync(abs) && newLine) ? '\n' + content : content;
                fs.appendFileSync(abs, toAppend, encoding as BufferEncoding);
                return createSuccessResult(createTextContent(`内容追加成功: ${abs}`));
            } catch (e: any) {
                logger.error(`append_file ${filePath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}

/** 在文件中搜索内容 */
export function createSearchInFileTool(config: FileSystemToolsConfig = { maxFileSize: 10 * 1024 * 1024 }): StructuredToolInterface {
    const maxSize = config.maxFileSize;
    return new DynamicStructuredTool({
        name: 'search_in_file',
        description: '在文件中搜索文本，返回匹配的行号和内容。路径必须是绝对路径。',
        schema: z.object({
            filePath: z.string().describe('文件的绝对路径'),
            searchText: z.string().describe('要搜索的文本或正则表达式'),
            useRegex: z.boolean().optional().default(false).describe('是否使用正则表达式'),
            caseSensitive: z.boolean().optional().default(true).describe('是否区分大小写，默认 true'),
            maxResults: z.number().optional().default(100).describe('最大返回结果数，默认 100'),
            encoding: z.enum(['utf8', 'utf-8', 'ascii']).optional().default('utf8').describe('文件编码'),
        }) as any,
        func: async ({ filePath, searchText, useRegex = false, caseSensitive = true, maxResults = 100, encoding = 'utf8' }: any): Promise<MCPToolResult> => {
            try {
                const { abs, stat } = checkFile(filePath);
                if (stat.size > maxSize) return createErrorResult(`文件过大: ${formatSize(stat.size)}`);
                const lines = fs.readFileSync(abs, encoding as BufferEncoding).toString().split('\n');
                const regex = useRegex ? new RegExp(searchText, caseSensitive ? 'g' : 'gi') : null;
                const matches: Array<{ line: number; content: string; matchPositions: number[] }> = [];
                for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
                    const line = lines[i];
                    const positions: number[] = [];
                    if (regex) {
                        regex.lastIndex = 0;
                        let m;
                        while ((m = regex.exec(line)) !== null) positions.push(m.index);
                    } else {
                        const searchIn = caseSensitive ? line : line.toLowerCase();
                        const searchFor = caseSensitive ? searchText : searchText.toLowerCase();
                        let pos = 0;
                        while ((pos = searchIn.indexOf(searchFor, pos)) !== -1) { positions.push(pos); pos += searchFor.length; }
                    }
                    if (positions.length > 0) matches.push({ line: i + 1, content: line, matchPositions: positions });
                }
                return createSuccessResult(createTextContent(JSON.stringify(matches, null, 2)));
            } catch (e: any) {
                logger.error(`search_in_file ${filePath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}

/** 按文件名模式搜索文件 */
export function createSearchFilesTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'search_files',
        description: '按文件名模式搜索文件，支持通配符（* 和 ?）。搜索路径必须是绝对路径。',
        schema: z.object({
            searchPath: z.string().describe('搜索目录的绝对路径'),
            pattern: z.string().describe('文件名匹配模式（如 *.js, test?.txt）'),
            recursive: z.boolean().optional().default(true).describe('是否递归搜索子目录，默认 true'),
            maxResults: z.number().optional().default(100).describe('最大返回数，默认 100'),
            includeHidden: z.boolean().optional().default(false).describe('是否包含隐藏文件'),
        }) as any,
        func: async ({ searchPath, pattern, recursive = true, maxResults = 100, includeHidden = false }: any): Promise<MCPToolResult> => {
            try {
                const abs = checkDir(searchPath);
                const regex = globToRegex(pattern);
                const results: Array<{ path: string; name: string; size: number; sizeFormatted: string; modified: Date }> = [];
                function walk(dir: string) {
                    if (results.length >= maxResults) return;
                    try {
                        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                            if (results.length >= maxResults) break;
                            if (!includeHidden && entry.name.startsWith('.')) continue;
                            const full = path.join(dir, entry.name);
                            if (entry.isFile() && regex.test(entry.name)) {
                                const s = fs.statSync(full);
                                results.push({ path: full, name: entry.name, size: s.size, sizeFormatted: formatSize(s.size), modified: s.mtime });
                            }
                            if (recursive && entry.isDirectory()) walk(full);
                        }
                    } catch (e: any) { logger.warn(`Cannot access ${dir}: ${e.message}`); }
                }
                walk(abs);
                return createSuccessResult(createTextContent(JSON.stringify(results, null, 2)));
            } catch (e: any) {
                logger.error(`search_files ${searchPath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}

/** grep 跨文件内容搜索 */
export function createGrepFilesTool(config: FileSystemToolsConfig = { maxFileSize: 10 * 1024 * 1024 }): StructuredToolInterface {
    const maxSize = config.maxFileSize;
    return new DynamicStructuredTool({
        name: 'grep_files',
        description: '在目录中搜索包含指定文本的文件（类似 grep -r）。搜索路径必须是绝对路径。',
        schema: z.object({
            searchPath: z.string().describe('搜索目录的绝对路径'),
            searchText: z.string().describe('要搜索的文本或正则表达式'),
            filePattern: z.string().optional().default('*').describe('文件名过滤模式（如 *.js）'),
            useRegex: z.boolean().optional().default(false).describe('是否使用正则表达式'),
            caseSensitive: z.boolean().optional().default(true).describe('是否区分大小写'),
            recursive: z.boolean().optional().default(true).describe('是否递归搜索'),
            maxResults: z.number().optional().default(50).describe('最大返回文件数，默认 50'),
            includeHidden: z.boolean().optional().default(false).describe('是否包含隐藏文件'),
        }) as any,
        func: async ({ searchPath, searchText, filePattern = '*', useRegex = false, caseSensitive = true, recursive = true, maxResults = 50, includeHidden = false }: any): Promise<MCPToolResult> => {
            try {
                const abs = checkDir(searchPath);
                const fileRegex = globToRegex(filePattern);
                // 提前构造搜索正则，避免在每行重复 new RegExp
                const searchRegex = useRegex ? new RegExp(searchText, caseSensitive ? '' : 'i') : null;
                const searchLower = caseSensitive ? searchText : searchText.toLowerCase();
                const results: Array<{ path: string; name: string; matches: Array<{ line: number; content: string }>; totalMatches: number }> = [];
                function searchInFile(fp: string): Array<{ line: number; content: string }> {
                    try {
                        if (fs.statSync(fp).size > maxSize) return [];
                        return fs.readFileSync(fp, 'utf8').split('\n').reduce((acc, line, i) => {
                            const hit = searchRegex
                                ? searchRegex.test(line)
                                : (caseSensitive ? line : line.toLowerCase()).includes(searchLower);
                            if (hit) acc.push({ line: i + 1, content: line });
                            return acc;
                        }, [] as Array<{ line: number; content: string }>);
                    } catch { return []; }
                }
                function walk(dir: string) {
                    if (results.length >= maxResults) return;
                    try {
                        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                            if (results.length >= maxResults) break;
                            if (!includeHidden && entry.name.startsWith('.')) continue;
                            const full = path.join(dir, entry.name);
                            if (entry.isFile() && fileRegex.test(entry.name)) {
                                const m = searchInFile(full);
                                if (m.length > 0) results.push({ path: full, name: entry.name, matches: m.slice(0, 10), totalMatches: m.length });
                            }
                            if (recursive && entry.isDirectory()) walk(full);
                        }
                    } catch (e: any) { logger.warn(`Cannot access ${dir}: ${e.message}`); }
                }
                walk(abs);
                return createSuccessResult(createTextContent(JSON.stringify(results, null, 2)));
            } catch (e: any) {
                logger.error(`grep_files ${searchPath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}

/** 列出目录内容（含文件大小）*/
export function createListDirectoryTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'list_directory',
        description: '列出目录下的文件和子目录，包含文件大小信息。可递归列出子目录。路径必须是绝对路径。',
        schema: z.object({
            dirPath: z.string().describe('目录的绝对路径'),
            recursive: z.boolean().optional().default(false).describe('是否递归列出子目录，默认 false'),
            includeHidden: z.boolean().optional().default(false).describe('是否包含隐藏文件，默认 false'),
        }) as any,
        func: async ({ dirPath, recursive = false, includeHidden = false }: any): Promise<MCPToolResult> => {
            try {
                const abs = checkDir(dirPath);
                function read(cur: string): any[] {
                    return fs.readdirSync(cur, { withFileTypes: true })
                        .filter(e => includeHidden || !e.name.startsWith('.'))
                        .map(e => {
                            const full = path.join(cur, e.name);
                            if (e.isDirectory()) {
                                const item: any = { name: e.name, type: 'directory', path: full };
                                if (recursive) item.children = read(full);
                                return item;
                            }
                            const s = fs.statSync(full);
                            return { name: e.name, type: 'file', path: full, size: s.size, sizeFormatted: formatSize(s.size), modified: s.mtime };
                        });
                }
                return createSuccessResult(createTextContent(JSON.stringify(read(abs), null, 2)));
            } catch (e: any) {
                logger.error(`list_directory ${dirPath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}

/** 删除文件 */
export function createDeleteFileTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'delete_file',
        description: '删除指定文件。此操作不可逆！路径必须是绝对路径。',
        schema: z.object({ filePath: z.string().describe('要删除的文件的绝对路径') }) as any,
        func: async ({ filePath }: any): Promise<MCPToolResult> => {
            try {
                const { abs } = checkFile(filePath);
                fs.unlinkSync(abs);
                return createSuccessResult(createTextContent(`文件删除成功: ${abs}`));
            } catch (e: any) {
                logger.error(`delete_file ${filePath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}

/** 检查文件/目录是否存在（含权限信息）*/
export function createFileExistsTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'file_exists',
        description: '检查文件或目录是否存在，返回类型、大小、时间戳、权限等详细信息。路径必须是绝对路径。',
        schema: z.object({ filePath: z.string().describe('要检查的文件或目录的绝对路径') }) as any,
        func: async ({ filePath }: any): Promise<MCPToolResult> => {
            try {
                const abs = resolvePath(filePath);
                if (!fs.existsSync(abs)) {
                    return createSuccessResult(createTextContent(JSON.stringify({ exists: false, filePath: abs }, null, 2)));
                }
                const s = fs.statSync(abs);
                return createSuccessResult(createTextContent(JSON.stringify({
                    exists: true,
                    filePath: abs,
                    type: s.isFile() ? 'file' : s.isDirectory() ? 'directory' : 'other',
                    size: s.size,
                    sizeFormatted: formatSize(s.size),
                    permissions: s.mode.toString(8).slice(-3),
                    created: s.birthtime,
                    modified: s.mtime,
                    accessed: s.atime,
                }, null, 2)));
            } catch (e: any) {
                logger.error(`file_exists ${filePath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}

/** 创建目录 */
export function createDirectoryTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'create_directory',
        description: '创建新目录，自动创建缺失的父目录。路径必须是绝对路径。',
        schema: z.object({
            dirPath: z.string().describe('要创建的目录的绝对路径'),
            recursive: z.boolean().optional().default(true).describe('是否递归创建父目录，默认 true'),
        }) as any,
        func: async ({ dirPath, recursive = true }: any): Promise<MCPToolResult> => {
            try {
                const abs = resolvePath(dirPath);
                if (fs.existsSync(abs)) return createErrorResult(`目录已存在: ${abs}`);
                fs.mkdirSync(abs, { recursive });
                return createSuccessResult(createTextContent(`目录创建成功: ${abs}`));
            } catch (e: any) {
                logger.error(`create_directory ${dirPath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}

/** 删除目录 */
export function createDeleteDirectoryTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'delete_directory',
        description: '删除目录及其所有内容。此操作不可逆！路径必须是绝对路径。',
        schema: z.object({
            dirPath: z.string().describe('要删除的目录的绝对路径'),
            recursive: z.boolean().optional().default(true).describe('是否递归删除，默认 true'),
        }) as any,
        func: async ({ dirPath, recursive = true }: any): Promise<MCPToolResult> => {
            try {
                const abs = checkDir(dirPath);
                fs.rmSync(abs, { recursive, force: true });
                return createSuccessResult(createTextContent(`目录删除成功: ${abs}`));
            } catch (e: any) {
                logger.error(`delete_directory ${dirPath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}

/** 移动/重命名文件或目录 */
export function createMoveFileTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'move_file',
        description: '移动或重命名文件/目录。源路径和目标路径都必须是绝对路径。',
        schema: z.object({
            sourcePath: z.string().describe('源文件或目录的绝对路径'),
            destPath: z.string().describe('目标路径的绝对路径'),
            overwrite: z.boolean().optional().default(false).describe('目标已存在时是否覆盖，默认 false'),
        }) as any,
        func: async ({ sourcePath, destPath, overwrite = false }: any): Promise<MCPToolResult> => {
            try {
                const src = resolvePath(sourcePath);
                const dst = resolvePath(destPath);
                if (!fs.existsSync(src)) throw new Error(`源路径不存在: ${src}`);
                if (fs.existsSync(dst) && !overwrite) return createErrorResult(`目标路径已存在: ${dst}（设置 overwrite=true 可覆盖）`);
                const destDir = path.dirname(dst);
                if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
                fs.renameSync(src, dst);
                return createSuccessResult(createTextContent(`移动成功: ${src} -> ${dst}`));
            } catch (e: any) {
                logger.error(`move_file ${sourcePath} -> ${destPath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}

/** 复制文件 */
export function createCopyFileTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'copy_file',
        description: '复制文件。源路径和目标路径都必须是绝对路径。',
        schema: z.object({
            sourcePath: z.string().describe('源文件的绝对路径'),
            destPath: z.string().describe('目标文件的绝对路径'),
            overwrite: z.boolean().optional().default(false).describe('目标已存在时是否覆盖，默认 false'),
        }) as any,
        func: async ({ sourcePath, destPath, overwrite = false }: any): Promise<MCPToolResult> => {
            try {
                const { abs: src } = checkFile(sourcePath);
                const dst = resolvePath(destPath);
                if (fs.existsSync(dst) && !overwrite) return createErrorResult(`目标文件已存在: ${dst}（设置 overwrite=true 可覆盖）`);
                const destDir = path.dirname(dst);
                if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
                fs.copyFileSync(src, dst);
                return createSuccessResult(createTextContent(`复制成功: ${src} -> ${dst}`));
            } catch (e: any) {
                logger.error(`copy_file ${sourcePath} -> ${destPath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}

/** 创建所有文件系统工具 */
export function createFileSystemTools(config: FileSystemToolsConfig = { maxFileSize: 10 * 1024 * 1024 }): StructuredToolInterface[] {
    return [
        // 读取
        createReadFileTool(config),
        createReadFileLinesTool(config),
        createReadMediaFileTool(),
        // 写入/编辑
        createWriteFileTool(),
        createEditFileTool(),
        createAppendFileTool(),
        // 搜索
        createSearchInFileTool(config),
        createSearchFilesTool(),
        createGrepFilesTool(config),
        // 目录
        createListDirectoryTool(),
        createDirectoryTool(),
        createDeleteDirectoryTool(),
        // 文件操作
        createDeleteFileTool(),
        createMoveFileTool(),
        createCopyFileTool(),
        createFileExistsTool(),
    ];
}
