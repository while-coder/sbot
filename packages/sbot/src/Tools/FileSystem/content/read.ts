import fs from 'fs';
import fsAsync from 'fs/promises';
import path from 'path';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { resolvePath } from '../utils';
import { loadPrompt } from '../../../Core/PromptLoader';

const logger = LoggerService.getLogger('Tools/FileSystem/content/read.ts');

const DEFAULT_LINE_LIMIT = 2000;
const MAX_CHARS = 50000;
const DEFAULT_CHAR_LIMIT = MAX_CHARS;

const BINARY_EXTS = new Set([
    '.zip', '.tar', '.gz', '.exe', '.dll', '.so', '.class', '.jar', '.war',
    '.7z', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods',
    '.odp', '.bin', '.dat', '.obj', '.o', '.a', '.lib', '.wasm', '.pyc', '.pyo',
]);

enum ReadMode {
    Line = 'line',
    Char = 'char',
    EndLine = 'endLine',
    EndChar = 'endChar',
}

async function isBinaryFile(filepath: string, fileSize: number): Promise<boolean> {
    if (BINARY_EXTS.has(path.extname(filepath).toLowerCase())) return true;
    if (fileSize === 0) return false;
    const fh = await fsAsync.open(filepath, 'r');
    try {
        const sampleSize = Math.min(4096, fileSize);
        const bytes = Buffer.alloc(sampleSize);
        const { bytesRead } = await fh.read(bytes, 0, sampleSize, 0);
        if (bytesRead === 0) return false;
        let nonPrintable = 0;
        for (let i = 0; i < bytesRead; i++) {
            if (bytes[i] === 0) return true;
            if (bytes[i] < 9 || (bytes[i] > 13 && bytes[i] < 32)) nonPrintable++;
        }
        return nonPrintable / bytesRead > 0.3;
    } finally {
        await fh.close();
    }
}

/**
 * 按 \n / \r\n 拆行，并记录每行在原始 text 中的起始 char offset。
 * - 行内不含行尾换行符；尾随换行不产生空行（与 readline 一致）
 * - starts[i] 是 lines[i] 在 text 中的起点（UTF-16 索引）
 */
function indexLines(text: string): { lines: string[], starts: number[] } {
    const lines: string[] = [];
    const starts: number[] = [];
    if (text === '') return { lines, starts };
    let lineStart = 0;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') {
            const lineEnd = i > 0 && text[i - 1] === '\r' ? i - 1 : i;
            lines.push(text.slice(lineStart, lineEnd));
            starts.push(lineStart);
            lineStart = i + 1;
        }
    }
    if (lineStart < text.length) {
        lines.push(text.slice(lineStart));
        starts.push(lineStart);
    }
    return { lines, starts };
}

/** 在 lines[from, stopAt) 范围内组装行格式输出（已假定整体 char 量在预算内） */
function readLines(lines: string[], from: number, stopAt: number): MCPToolResult {
    const total = lines.length;
    // 起点超出文件范围才算越界；from === total 在空文件 + offset=1 时合法（输出空内容 + EOF 提示）
    if (from > 0 && from >= total) {
        return createErrorResult(`Offset ${from + 1} is out of range for this file (${total} lines)`);
    }

    const raw = lines.slice(from, stopAt);
    const lastReadLine = from + raw.length;
    const parts: string[] = [];

    if (from > 0) {
        parts.push(`(Above: lines (1-${from}) not read)`);
    }

    parts.push(raw.join('\n'));

    if (lastReadLine >= total) {
        parts.push(`(End of file - ${total} lines total)`);
    } else {
        parts.push(`(Below: lines (${lastReadLine + 1}-${total}) not read)`);
    }

    return createSuccessResult(createTextContent(parts.join('\n\n')));
}

/** 在 text[from, end) 范围内拼接 char 格式输出，end 可超出 text.length，自动夹断 */
function readChars(text: string, from: number, end: number, prefixNote?: string): MCPToolResult {
    const total = text.length;
    if (from > total) {
        return createErrorResult(`Char offset ${from} is past end of file (length ${total})`);
    }

    const stopAt = Math.min(end, total);
    const parts: string[] = [];

    if (prefixNote) parts.push(prefixNote);
    if (from > 0) {
        parts.push(`(Above: chars (0-${from - 1}) not read)`);
    }

    parts.push(text.slice(from, stopAt));

    if (stopAt >= total) {
        parts.push(`(End of file - ${total} chars total)`);
    } else {
        parts.push(`(Below: chars (${stopAt}-${total - 1}) not read)`);
    }

    return createSuccessResult(createTextContent(parts.join('\n\n')));
}

/** 读取文件，支持 line/char 模式以及从末尾计数（endLine/endChar） */
export function createReadTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'read',
        description: loadPrompt('tools/fs/read.txt'),
        schema: z.object({
            filePath: z.string().describe('Absolute path to the file'),
            mode: z.enum(ReadMode).optional()
                .describe('line/char: from start. endLine/endChar: from EOF. Default "line".'),
            offset: z.number().int().min(0).optional()
                .describe('line: 1-indexed start line (>=1). char: 0-indexed start char (>=0). endLine/endChar: 1-indexed distance from EOF (>=1, defaults to limit so "last N" works with just limit).'),
            limit: z.number().int().positive().optional()
                .describe(`Max lines (line/endLine, default ${DEFAULT_LINE_LIMIT}) or max chars (char/endChar, capped at ${MAX_CHARS}).`),
        }).superRefine((data, ctx) => {
            if (data.offset !== undefined && data.offset < 1 && (data.mode ?? ReadMode.Line) !== ReadMode.Char) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['offset'],
                    message: `offset must be >= 1 in ${data.mode ?? ReadMode.Line} mode (only char mode accepts 0)`,
                });
            }
        }) as any,
        func: async ({ filePath, mode, offset, limit }: any): Promise<MCPToolResult> => {
            try {
                const abs = resolvePath(filePath);

                if (!fs.existsSync(abs)) {
                    const dir = path.dirname(abs);
                    const base = path.basename(abs).toLowerCase();
                    const suggestions = await fsAsync.readdir(dir)
                        .then(entries => entries
                            .filter(e => e.toLowerCase().includes(base) || base.includes(e.toLowerCase()))
                            .map(e => path.join(dir, e))
                            .slice(0, 3))
                        .catch(() => []);
                    const hint = suggestions.length > 0 ? `\n\nDid you mean one of these?\n${suggestions.join('\n')}` : '';
                    return createErrorResult(`File not found: ${abs}${hint}`);
                }

                const stat = fs.statSync(abs);
                if (stat.isDirectory()) {
                    return createErrorResult(`${abs} is a directory. Use the ls tool to list directory contents.`);
                }
                if (await isBinaryFile(abs, stat.size)) {
                    return createErrorResult(`Cannot read binary file: ${abs}`);
                }

                const m: ReadMode = mode ?? ReadMode.Line;
                const text = await fsAsync.readFile(abs, 'utf8');

                if (m === ReadMode.Char || m === ReadMode.EndChar) {
                    const want = Math.min(limit ?? DEFAULT_CHAR_LIMIT, MAX_CHARS);
                    const from = m === ReadMode.EndChar
                        ? Math.max(0, text.length - (offset ?? want))
                        : (offset ?? 0);
                    return readChars(text, from, from + want);
                }

                const lim = limit ?? DEFAULT_LINE_LIMIT;
                const { lines, starts } = indexLines(text);
                const from = m === ReadMode.EndLine
                    ? Math.max(0, lines.length - (offset ?? lim))
                    : (offset ?? 1) - 1;
                const stopAt = Math.min(from + lim, lines.length);

                // 请求的行范围在原始 text 中对应的 char 量超过 MAX_CHARS 时，
                // 整体降级为 char 格式输出，让 LLM 通过 mode="char" offset=N 续读未读部分
                const charStart = starts[from] ?? text.length;
                const charEnd = stopAt < lines.length ? starts[stopAt] : text.length;
                if (charEnd - charStart > MAX_CHARS) {
                    return readChars(
                        text,
                        charStart,
                        charStart + MAX_CHARS,
                        `(Note: requested lines (${from + 1}-${stopAt}) exceed ${MAX_CHARS} chars; switched to char view)`,
                    );
                }
                return readLines(lines, from, stopAt);
            } catch (e: any) {
                logger.error(`read ${filePath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}
