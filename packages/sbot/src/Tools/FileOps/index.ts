/**
 * 文件操作工具集（Claude Code 风格）
 * 提供 read, write, edit, multiedit, apply_patch, glob, grep, ls 8 个工具
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
import { loadPrompt } from '../_prompts/index';

const logger = LoggerService.getLogger('Tools/FileOps/index.ts');

// ── 工具函数 ───────────────────────────────────────────────────────────────────

function resolvePath(p: string): string {
    if (!path.isAbsolute(p)) throw new Error(`路径必须是绝对路径: ${p}`);
    return path.normalize(p);
}

function normalizeLineEndings(text: string): string {
    return text.replace(/\r\n/g, '\n');
}

/** 原子写入：先写临时文件再 rename */
async function writeAtomic(filePath: string, content: string): Promise<void> {
    const tmp = `${filePath}.${randomBytes(16).toString('hex')}.tmp`;
    try {
        await fsAsync.writeFile(tmp, content, 'utf-8');
        await fsAsync.rename(tmp, filePath);
    } catch (e) {
        try { await fsAsync.unlink(tmp); } catch { /* ignore */ }
        throw e;
    }
}

/** 将 glob 模式（支持 ** / * / ?）转成正则 */
function globToRegex(pattern: string): RegExp {
    let re = '';
    let i = 0;
    while (i < pattern.length) {
        const c = pattern[i];
        if (c === '*') {
            if (pattern[i + 1] === '*') {
                // ** 匹配任意路径（含分隔符）
                re += '.*';
                i += 2;
                if (pattern[i] === '/' || pattern[i] === '\\') i++; // 跳过紧跟的分隔符
            } else {
                // * 匹配除路径分隔符外的任意字符
                re += '[^/\\\\]*';
                i++;
            }
        } else if (c === '?') {
            re += '[^/\\\\]';
            i++;
        } else if (c === '{') {
            // 简单的 {a,b} 替代组
            const close = pattern.indexOf('}', i);
            if (close > i) {
                const options = pattern.slice(i + 1, close).split(',').map(o => o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
                re += `(?:${options.join('|')})`;
                i = close + 1;
            } else {
                re += '\\{';
                i++;
            }
        } else if ('.+^$|()[]\\'.includes(c)) {
            re += '\\' + c;
            i++;
        } else {
            re += c;
            i++;
        }
    }
    return new RegExp('^' + re + '$', 'i');
}

// ── read ────────────────────────────────────────────────────────────────────────

export function createReadTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'read',
        description: loadPrompt('read') || '读取文件或目录内容',
        schema: z.object({
            filePath: z.string().describe('文件或目录的绝对路径'),
            offset: z.number().int().min(1).optional().describe('起始行号（1-indexed），默认从第 1 行开始'),
            limit: z.number().int().min(1).optional().default(2000).describe('最大读取行数，默认 2000'),
        }) as any,
        func: async ({ filePath, offset, limit = 2000 }: any): Promise<MCPToolResult> => {
            try {
                const abs = resolvePath(filePath);
                if (!fs.existsSync(abs)) return createErrorResult(`路径不存在: ${abs}`);

                const stat = fs.statSync(abs);

                // 目录：列出内容
                if (stat.isDirectory()) {
                    const entries = fs.readdirSync(abs, { withFileTypes: true });
                    const lines = entries.map(e => e.isDirectory() ? `${e.name}/` : e.name);
                    return createSuccessResult(createTextContent(lines.join('\n')));
                }

                // 文件：带行号前缀读取
                const content = normalizeLineEndings(fs.readFileSync(abs, 'utf-8'));
                const allLines = content.split('\n');
                const startLine = (offset ?? 1) - 1; // 转为 0-indexed
                const endLine = Math.min(startLine + limit, allLines.length);
                const selectedLines = allLines.slice(startLine, endLine);

                const MAX_LINE_LENGTH = 2000;
                const numbered = selectedLines.map((line, i) => {
                    const lineNum = startLine + i + 1;
                    const truncated = line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) + '...' : line;
                    return `${lineNum}: ${truncated}`;
                });

                let result = numbered.join('\n');
                if (endLine < allLines.length) {
                    result += `\n\n[文件共 ${allLines.length} 行，已显示 ${startLine + 1}-${endLine} 行。使用 offset=${endLine + 1} 继续读取]`;
                }

                return createSuccessResult(createTextContent(result));
            } catch (e: any) {
                logger.error(`read ${filePath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        },
    });
}

// ── write ───────────────────────────────────────────────────────────────────────

export function createWriteTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'write',
        description: loadPrompt('write') || '写入文件内容',
        schema: z.object({
            file_path: z.string().describe('文件的绝对路径'),
            content: z.string().describe('要写入的内容'),
        }) as any,
        func: async ({ file_path, content }: any): Promise<MCPToolResult> => {
            try {
                const abs = resolvePath(file_path);
                const dir = path.dirname(abs);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                await writeAtomic(abs, content);
                return createSuccessResult(createTextContent(`文件写入成功: ${abs}`));
            } catch (e: any) {
                logger.error(`write ${file_path}: ${e.message}`);
                return createErrorResult(e.message);
            }
        },
    });
}

// ── edit ────────────────────────────────────────────────────────────────────────

export function createEditTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'edit',
        description: loadPrompt('edit') || '精确字符串替换编辑文件',
        schema: z.object({
            file_path: z.string().describe('文件的绝对路径'),
            old_string: z.string().describe('要替换的原始文本'),
            new_string: z.string().describe('替换后的新文本'),
            replace_all: z.boolean().optional().default(false).describe('是否替换所有匹配，默认 false'),
        }) as any,
        func: async ({ file_path, old_string, new_string, replace_all = false }: any): Promise<MCPToolResult> => {
            try {
                const abs = resolvePath(file_path);

                // 新文件创建：old_string 为空
                if (old_string === '') {
                    const dir = path.dirname(abs);
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    await writeAtomic(abs, new_string);
                    return createSuccessResult(createTextContent(`文件已创建: ${abs}`));
                }

                if (!fs.existsSync(abs)) return createErrorResult(`文件不存在: ${abs}`);
                const content = normalizeLineEndings(fs.readFileSync(abs, 'utf-8'));
                const oldNorm = normalizeLineEndings(old_string);

                if (!content.includes(oldNorm)) {
                    return createErrorResult('oldString not found in content');
                }

                // 检查多次匹配
                if (!replace_all) {
                    const firstIdx = content.indexOf(oldNorm);
                    const secondIdx = content.indexOf(oldNorm, firstIdx + 1);
                    if (secondIdx !== -1) {
                        return createErrorResult('Found multiple matches for oldString. Provide more surrounding lines in oldString to identify the correct match.');
                    }
                }

                const modified = replace_all
                    ? content.split(oldNorm).join(new_string)
                    : content.replace(oldNorm, new_string);

                const diff = createTwoFilesPatch(file_path, file_path, content, modified, 'original', 'modified');
                await writeAtomic(abs, modified);

                return createSuccessResult(createTextContent(diff));
            } catch (e: any) {
                logger.error(`edit ${file_path}: ${e.message}`);
                return createErrorResult(e.message);
            }
        },
    });
}

// ── multiedit ───────────────────────────────────────────────────────────────────

export function createMultiEditTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'multiedit',
        description: loadPrompt('multiedit') || '对单个文件进行多处编辑',
        schema: z.object({
            file_path: z.string().describe('文件的绝对路径'),
            edits: z.array(z.object({
                old_string: z.string().describe('要替换的原始文本'),
                new_string: z.string().describe('替换后的新文本'),
                replace_all: z.boolean().optional().default(false).describe('是否替换所有匹配'),
            })).describe('编辑操作列表，按顺序依次应用'),
        }) as any,
        func: async ({ file_path, edits }: any): Promise<MCPToolResult> => {
            try {
                const abs = resolvePath(file_path);

                // 处理第一个 edit 是创建新文件的情况
                let content: string;
                if (edits.length > 0 && edits[0].old_string === '') {
                    const dir = path.dirname(abs);
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    content = edits[0].new_string;
                    edits = edits.slice(1);
                } else {
                    if (!fs.existsSync(abs)) return createErrorResult(`文件不存在: ${abs}`);
                    content = normalizeLineEndings(fs.readFileSync(abs, 'utf-8'));
                }

                const original = content;

                for (let i = 0; i < edits.length; i++) {
                    const { old_string, new_string, replace_all = false } = edits[i];
                    const oldNorm = normalizeLineEndings(old_string);

                    if (!content.includes(oldNorm)) {
                        return createErrorResult(`编辑 #${i + 1}: oldString not found in content`);
                    }

                    if (!replace_all) {
                        const firstIdx = content.indexOf(oldNorm);
                        const secondIdx = content.indexOf(oldNorm, firstIdx + 1);
                        if (secondIdx !== -1) {
                            return createErrorResult(`编辑 #${i + 1}: Found multiple matches for oldString.`);
                        }
                    }

                    content = replace_all
                        ? content.split(oldNorm).join(new_string)
                        : content.replace(oldNorm, new_string);
                }

                const diff = createTwoFilesPatch(file_path, file_path, original, content, 'original', 'modified');
                await writeAtomic(abs, content);

                return createSuccessResult(createTextContent(diff));
            } catch (e: any) {
                logger.error(`multiedit ${file_path}: ${e.message}`);
                return createErrorResult(e.message);
            }
        },
    });
}

// ── apply_patch ─────────────────────────────────────────────────────────────────

interface PatchOperation {
    type: 'add' | 'delete' | 'update';
    path: string;
    moveTo?: string;
    content?: string;     // add 文件内容
    hunks?: PatchHunk[];  // update 的 hunks
}

interface PatchHunk {
    context?: string; // @@ 行后面的 context
    removes: string[];
    adds: string[];
}

function parsePatch(patchText: string): PatchOperation[] {
    const lines = normalizeLineEndings(patchText).split('\n');
    const ops: PatchOperation[] = [];
    let current: PatchOperation | null = null;
    let currentHunk: PatchHunk | null = null;

    for (const line of lines) {
        if (line.startsWith('*** Begin Patch') || line.startsWith('*** End Patch')) continue;

        if (line.startsWith('*** Add File: ')) {
            current = { type: 'add', path: line.slice('*** Add File: '.length).trim(), content: '' };
            ops.push(current);
            currentHunk = null;
            continue;
        }
        if (line.startsWith('*** Delete File: ')) {
            current = { type: 'delete', path: line.slice('*** Delete File: '.length).trim() };
            ops.push(current);
            currentHunk = null;
            continue;
        }
        if (line.startsWith('*** Update File: ')) {
            current = { type: 'update', path: line.slice('*** Update File: '.length).trim(), hunks: [] };
            ops.push(current);
            currentHunk = null;
            continue;
        }
        if (line.startsWith('*** Move to: ') && current?.type === 'update') {
            current.moveTo = line.slice('*** Move to: '.length).trim();
            continue;
        }

        if (current?.type === 'add') {
            if (line.startsWith('+')) {
                current.content = (current.content || '') + (current.content ? '\n' : '') + line.slice(1);
            }
            continue;
        }

        if (current?.type === 'update') {
            if (line.startsWith('@@ ')) {
                currentHunk = { context: line.slice(3).trim(), removes: [], adds: [] };
                current.hunks!.push(currentHunk);
                continue;
            }
            if (currentHunk) {
                if (line.startsWith('-')) {
                    currentHunk.removes.push(line.slice(1));
                } else if (line.startsWith('+')) {
                    currentHunk.adds.push(line.slice(1));
                }
                // 无前缀的行是上下文，忽略
            }
        }
    }

    return ops;
}

function applyPatchOps(ops: PatchOperation[]): string[] {
    const results: string[] = [];

    for (const op of ops) {
        const abs = path.isAbsolute(op.path) ? op.path : path.resolve(process.cwd(), op.path);

        switch (op.type) {
            case 'add': {
                const dir = path.dirname(abs);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(abs, op.content || '', 'utf-8');
                results.push(`创建文件: ${abs}`);
                break;
            }
            case 'delete': {
                if (fs.existsSync(abs)) {
                    fs.unlinkSync(abs);
                    results.push(`删除文件: ${abs}`);
                } else {
                    results.push(`文件不存在（跳过删除）: ${abs}`);
                }
                break;
            }
            case 'update': {
                if (!fs.existsSync(abs)) {
                    results.push(`错误: 文件不存在: ${abs}`);
                    break;
                }

                let content = normalizeLineEndings(fs.readFileSync(abs, 'utf-8'));
                const contentLines = content.split('\n');

                // 应用每个 hunk
                for (const hunk of op.hunks || []) {
                    if (hunk.removes.length === 0 && hunk.adds.length === 0) continue;

                    // 查找 hunk 匹配位置
                    let found = false;
                    if (hunk.removes.length > 0) {
                        // 查找要删除的行
                        for (let i = 0; i <= contentLines.length - hunk.removes.length; i++) {
                            const match = hunk.removes.every((r, j) => contentLines[i + j].trim() === r.trim());
                            if (match) {
                                contentLines.splice(i, hunk.removes.length, ...hunk.adds);
                                found = true;
                                break;
                            }
                        }
                    } else if (hunk.context) {
                        // 纯添加：在 context 行之后插入
                        for (let i = 0; i < contentLines.length; i++) {
                            if (contentLines[i].trim() === hunk.context.trim()) {
                                contentLines.splice(i + 1, 0, ...hunk.adds);
                                found = true;
                                break;
                            }
                        }
                    }

                    if (!found && hunk.removes.length > 0) {
                        results.push(`警告: 无法匹配 hunk (context: ${hunk.context || 'none'})`);
                    }

                    content = contentLines.join('\n');
                }

                const finalContent = contentLines.join('\n');
                const targetPath = op.moveTo
                    ? (path.isAbsolute(op.moveTo) ? op.moveTo : path.resolve(process.cwd(), op.moveTo))
                    : abs;

                if (op.moveTo) {
                    const targetDir = path.dirname(targetPath);
                    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
                }

                fs.writeFileSync(targetPath, finalContent, 'utf-8');

                if (op.moveTo && targetPath !== abs) {
                    fs.unlinkSync(abs);
                    results.push(`更新并移动文件: ${abs} -> ${targetPath}`);
                } else {
                    results.push(`更新文件: ${abs}`);
                }
                break;
            }
        }
    }

    return results;
}

export function createApplyPatchTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'apply_patch',
        description: loadPrompt('apply_patch') || '应用自定义 patch 格式的文件修改',
        schema: z.object({
            patch: z.string().describe('Patch 内容（使用 *** Begin Patch / *** End Patch 格式）'),
        }) as any,
        func: async ({ patch }: any): Promise<MCPToolResult> => {
            try {
                const ops = parsePatch(patch);
                if (ops.length === 0) {
                    return createErrorResult('无法解析 patch 内容，请检查格式');
                }
                const results = applyPatchOps(ops);
                return createSuccessResult(createTextContent(results.join('\n')));
            } catch (e: any) {
                logger.error(`apply_patch: ${e.message}`);
                return createErrorResult(e.message);
            }
        },
    });
}

// ── glob ────────────────────────────────────────────────────────────────────────

export function createGlobTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'glob',
        description: loadPrompt('glob') || '按 glob 模式匹配文件路径',
        schema: z.object({
            pattern: z.string().describe('Glob 模式，如 "**/*.ts" 或 "src/**/*.js"'),
            path: z.string().optional().describe('搜索根目录的绝对路径，默认为当前目录'),
        }) as any,
        func: async ({ pattern, path: searchPath }: any): Promise<MCPToolResult> => {
            try {
                const rootDir = searchPath ? resolvePath(searchPath) : process.cwd();
                if (!fs.existsSync(rootDir)) return createErrorResult(`目录不存在: ${rootDir}`);

                const regex = globToRegex(pattern);
                const results: { filePath: string; mtime: number }[] = [];
                const MAX_RESULTS = 500;

                function walk(dir: string, relPrefix: string) {
                    if (results.length >= MAX_RESULTS) return;
                    try {
                        const entries = fs.readdirSync(dir, { withFileTypes: true });
                        for (const entry of entries) {
                            if (results.length >= MAX_RESULTS) break;
                            if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

                            const fullPath = path.join(dir, entry.name);
                            const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;

                            if (entry.isFile()) {
                                if (regex.test(relPath)) {
                                    const stat = fs.statSync(fullPath);
                                    results.push({ filePath: fullPath, mtime: stat.mtimeMs });
                                }
                            } else if (entry.isDirectory()) {
                                walk(fullPath, relPath);
                            }
                        }
                    } catch { /* 权限不足等，跳过 */ }
                }

                walk(rootDir, '');

                // 按修改时间倒序排列
                results.sort((a, b) => b.mtime - a.mtime);
                const output = results.map(r => r.filePath).join('\n');

                if (results.length === 0) {
                    return createSuccessResult(createTextContent('没有找到匹配的文件'));
                }

                let text = output;
                if (results.length >= MAX_RESULTS) {
                    text += `\n\n[结果已截断，仅显示前 ${MAX_RESULTS} 个匹配]`;
                }

                return createSuccessResult(createTextContent(text));
            } catch (e: any) {
                logger.error(`glob: ${e.message}`);
                return createErrorResult(e.message);
            }
        },
    });
}

// ── grep ────────────────────────────────────────────────────────────────────────

export function createGrepTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'grep',
        description: loadPrompt('grep') || '按正则搜索文件内容',
        schema: z.object({
            pattern: z.string().describe('正则表达式搜索模式'),
            path: z.string().optional().describe('搜索路径（文件或目录的绝对路径），默认当前目录'),
            include: z.string().optional().describe('文件名过滤模式，如 "*.ts" 或 "*.{js,jsx}"'),
        }) as any,
        func: async ({ pattern, path: searchPath, include }: any): Promise<MCPToolResult> => {
            try {
                const rootDir = searchPath ? resolvePath(searchPath) : process.cwd();
                if (!fs.existsSync(rootDir)) return createErrorResult(`路径不存在: ${rootDir}`);

                const searchRegex = new RegExp(pattern);
                const includeRegex = include ? globToRegex(include) : null;
                const MAX_FILE_SIZE = 5 * 1024 * 1024;
                const MAX_FILES = 100;
                const results: { filePath: string; matches: { line: number; content: string }[]; mtime: number }[] = [];

                // 单文件搜索
                const rootStat = fs.statSync(rootDir);
                if (rootStat.isFile()) {
                    const content = fs.readFileSync(rootDir, 'utf-8');
                    const lines = content.split('\n');
                    const matches: { line: number; content: string }[] = [];
                    for (let i = 0; i < lines.length; i++) {
                        if (searchRegex.test(lines[i])) {
                            matches.push({ line: i + 1, content: lines[i] });
                        }
                    }
                    if (matches.length > 0) {
                        return createSuccessResult(createTextContent(
                            matches.map(m => `${rootDir}:${m.line}: ${m.content}`).join('\n')
                        ));
                    }
                    return createSuccessResult(createTextContent('没有找到匹配'));
                }

                // 目录搜索
                function walk(dir: string) {
                    if (results.length >= MAX_FILES) return;
                    try {
                        const entries = fs.readdirSync(dir, { withFileTypes: true });
                        for (const entry of entries) {
                            if (results.length >= MAX_FILES) break;
                            if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

                            const fullPath = path.join(dir, entry.name);

                            if (entry.isFile()) {
                                if (includeRegex && !includeRegex.test(entry.name)) continue;
                                try {
                                    const stat = fs.statSync(fullPath);
                                    if (stat.size > MAX_FILE_SIZE) continue;
                                    const content = fs.readFileSync(fullPath, 'utf-8');
                                    const lines = content.split('\n');
                                    const matches: { line: number; content: string }[] = [];
                                    for (let i = 0; i < lines.length; i++) {
                                        if (searchRegex.test(lines[i])) {
                                            matches.push({ line: i + 1, content: lines[i] });
                                            if (matches.length >= 20) break; // 每文件最多 20 个匹配
                                        }
                                    }
                                    if (matches.length > 0) {
                                        results.push({ filePath: fullPath, matches, mtime: stat.mtimeMs });
                                    }
                                } catch { /* 二进制文件等，跳过 */ }
                            } else if (entry.isDirectory()) {
                                walk(fullPath);
                            }
                        }
                    } catch { /* 权限不足等，跳过 */ }
                }

                walk(rootDir);

                if (results.length === 0) {
                    return createSuccessResult(createTextContent('没有找到匹配'));
                }

                // 按修改时间倒序排列
                results.sort((a, b) => b.mtime - a.mtime);

                const output = results.map(r =>
                    r.matches.map(m => `${r.filePath}:${m.line}: ${m.content}`).join('\n')
                ).join('\n');

                let text = output;
                if (results.length >= MAX_FILES) {
                    text += `\n\n[结果已截断，仅显示前 ${MAX_FILES} 个文件的匹配]`;
                }

                return createSuccessResult(createTextContent(text));
            } catch (e: any) {
                if (e instanceof SyntaxError || e.message?.includes('Invalid regular expression')) {
                    return createErrorResult(`无效的正则表达式: ${pattern}`);
                }
                logger.error(`grep: ${e.message}`);
                return createErrorResult(e.message);
            }
        },
    });
}

// ── ls ──────────────────────────────────────────────────────────────────────────

export function createLsTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'ls',
        description: loadPrompt('ls') || '列出目录内容',
        schema: z.object({
            path: z.string().optional().describe('目录的绝对路径，默认为当前工作目录'),
            ignore: z.array(z.string()).optional().describe('要忽略的 glob 模式数组'),
        }) as any,
        func: async ({ path: dirPath, ignore }: any): Promise<MCPToolResult> => {
            try {
                const abs = dirPath ? resolvePath(dirPath) : process.cwd();
                if (!fs.existsSync(abs)) return createErrorResult(`路径不存在: ${abs}`);
                if (!fs.statSync(abs).isDirectory()) return createErrorResult(`不是目录: ${abs}`);

                const ignoreRegexes = (ignore || []).map((p: string) => globToRegex(p));
                const entries = fs.readdirSync(abs, { withFileTypes: true });

                const lines: string[] = [];
                for (const entry of entries) {
                    if (ignoreRegexes.some((r: RegExp) => r.test(entry.name))) continue;
                    lines.push(entry.isDirectory() ? `${entry.name}/` : entry.name);
                }

                return createSuccessResult(createTextContent(lines.join('\n')));
            } catch (e: any) {
                logger.error(`ls: ${e.message}`);
                return createErrorResult(e.message);
            }
        },
    });
}

// ── 导出工具集 ──────────────────────────────────────────────────────────────────

export function createFileOpsTools(): StructuredToolInterface[] {
    return [
        createReadTool(),
        createWriteTool(),
        createEditTool(),
        createMultiEditTool(),
        createApplyPatchTool(),
        createGlobTool(),
        createGrepTool(),
        createLsTool(),
    ];
}
