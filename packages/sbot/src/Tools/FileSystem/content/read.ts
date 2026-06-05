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
const MAX_LINE_CHARS = 2000;
const MAX_LINE_OUTPUT_BYTES = 50 * 1024;
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

// 按 \n / \r\n 拆行；行为对齐 readline：尾随换行不产生空行，空文件返回空数组
function splitLines(text: string): string[] {
    if (text === '') return [];
    const lines = text.split(/\r?\n/);
    if (lines[lines.length - 1] === '') lines.pop();
    return lines;
}

// 单行字符（codepoint）超长时截断；ASCII 行用 text.length 快速短路（UTF-16 单元数 ≥ codepoint 数）
function truncateLine(text: string): string {
    if (text.length <= MAX_LINE_CHARS) return text;
    const chars = Array.from(text);
    if (chars.length <= MAX_LINE_CHARS) return text;
    return chars.slice(0, MAX_LINE_CHARS).join('') + `... (line truncated to ${MAX_LINE_CHARS} chars)`;
}

/**
 * 在 lines[from, end) 范围内组装输出，应用单行字符截断和总输出字节上限。
 * from / end 均为 0-indexed；end 可超出 lines.length，自动夹断。
 */
function readLines(lines: string[], from: number, end: number): MCPToolResult {
    const total = lines.length;
    // 起点超出文件范围才算越界；from === total 在空文件 + offset=1 时合法（输出空内容 + EOF 提示）
    if (from > 0 && from >= total) {
        return createErrorResult(`Offset ${from + 1} is out of range for this file (${total} lines)`);
    }

    const stopAt = Math.min(end, total);
    const raw: string[] = [];
    let outputBytes = 0;
    let sizeCapped = false;
    for (let i = from; i < stopAt; i++) {
        const line = truncateLine(lines[i]);
        const size = Buffer.byteLength(line, 'utf-8') + (raw.length > 0 ? 1 : 0);
        if (outputBytes + size > MAX_LINE_OUTPUT_BYTES) { sizeCapped = true; break; }
        raw.push(line);
        outputBytes += size;
    }

    const startLine = from + 1;
    const lastReadLine = startLine + raw.length - 1;
    const nextOffset = lastReadLine + 1;
    const parts: string[] = [];

    // 前置：起点之前没有读到的行
    if (from > 0) {
        parts.push(`(Above: ${from} earlier line${from === 1 ? '' : 's'} (1-${from}) not read. Use mode="line" offset=1 limit=${from} to read them.)`);
    }

    parts.push(raw.join('\n'));

    // 后置：基于实际读到的位置 + 文件总行数
    if (sizeCapped) {
        const after = total - lastReadLine;
        parts.push(`(Below: output capped at ${MAX_LINE_OUTPUT_BYTES / 1024}KB after reading lines ${startLine}-${lastReadLine}; ${after} more line${after === 1 ? '' : 's'} (${nextOffset}-${total}) not read. Use mode="line" offset=${nextOffset} to continue.)`);
    } else if (lastReadLine >= total) {
        parts.push(`(End of file - total ${total} lines)`);
    } else {
        const after = total - lastReadLine;
        parts.push(`(Below: ${after} more line${after === 1 ? '' : 's'} (${nextOffset}-${total}) not read. Use mode="line" offset=${nextOffset} to continue.)`);
    }

    return createSuccessResult(createTextContent(parts.join('\n\n')));
}

/** 在 chars[from, end) 范围内拼接输出，end 可超出 chars.length，自动夹断 */
function readChars(chars: string[], from: number, end: number): MCPToolResult {
    const total = chars.length;
    if (from > total) {
        return createErrorResult(`Char offset ${from} is past end of file (length ${total})`);
    }

    const stopAt = Math.min(end, total);
    const text = chars.slice(from, stopAt).join('');
    const parts: string[] = [];

    if (from > 0) {
        parts.push(`(Above: ${from} earlier char${from === 1 ? '' : 's'} (0-${from - 1}) not read. Use mode="char" offset=0 limit=${from} to read them.)`);
    }

    parts.push(text);

    if (stopAt >= total) {
        parts.push(`(End of file at char ${total})`);
    } else {
        const after = total - stopAt;
        parts.push(`(Below: ${after} more char${after === 1 ? '' : 's'} (${stopAt}-${total - 1}) not read. Use mode="char" offset=${stopAt} to continue.)`);
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
                .describe('line: 1-indexed start line. char: 0-indexed start char. endLine/endChar: distance from EOF where read starts (defaults to limit so "last N" works with just limit).'),
            limit: z.number().int().positive().optional()
                .describe(`Max lines (line/endLine, default ${DEFAULT_LINE_LIMIT}) or max chars (char/endChar, capped at ${MAX_CHARS}).`),
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
                    if (m === ReadMode.EndChar && offset != null && offset < 1) {
                        return createErrorResult('Offset must be >= 1 for endChar mode. Omit offset to read the last limit chars.');
                    }
                    const want = Math.min(limit ?? DEFAULT_CHAR_LIMIT, MAX_CHARS);
                    const chars = Array.from(text);
                    const from = m === ReadMode.EndChar
                        ? Math.max(0, chars.length - (offset ?? want))
                        : (offset ?? 0);
                    return readChars(chars, from, from + want);
                }

                const lim = limit ?? DEFAULT_LINE_LIMIT;
                const lines = splitLines(text);
                let from: number;
                if (m === ReadMode.EndLine) {
                    if (offset != null && offset < 1) {
                        return createErrorResult('Offset must be >= 1 for endLine mode. Omit offset to read the last limit lines.');
                    }
                    from = Math.max(0, lines.length - (offset ?? lim));
                } else {
                    if (offset != null && offset < 1) {
                        return createErrorResult('Offset must be >= 1 for line mode.');
                    }
                    from = (offset ?? 1) - 1;
                }
                return readLines(lines, from, from + lim);
            } catch (e: any) {
                logger.error(`read ${filePath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}
