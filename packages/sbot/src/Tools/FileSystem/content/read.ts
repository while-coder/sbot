import fs from 'fs';
import fsAsync from 'fs/promises';
import path from 'path';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { resolvePath } from '../utils';
import { loadPrompt } from '../../../Core/PromptLoader';

const logger = LoggerService.getLogger('Tools/FileSystem/content/read.ts');

const DEFAULT_LINE_LIMIT = 2000;
const MAX_LINE = 2000;
const MAX_BYTES = 50 * 1024;
const DEFAULT_BYTE_LIMIT = MAX_BYTES;

const BINARY_EXTS = new Set([
    '.zip', '.tar', '.gz', '.exe', '.dll', '.so', '.class', '.jar', '.war',
    '.7z', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods',
    '.odp', '.bin', '.dat', '.obj', '.o', '.a', '.lib', '.wasm', '.pyc', '.pyo',
]);

enum ReadMode {
    Line = 'line',
    Byte = 'byte',
    EndLine = 'endLine',
    EndByte = 'endByte',
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

async function countLines(filepath: string): Promise<number> {
    const stream = createReadStream(filepath, { encoding: 'utf8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    let count = 0;
    try {
        for await (const _ of rl) count++;
    } finally {
        rl.close();
        stream.destroy();
    }
    return count;
}

async function readByLines(abs: string, startLine: number, limit: number, totalHint?: number): Promise<MCPToolResult> {
    const stream = createReadStream(abs, { encoding: 'utf8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    const start = startLine - 1;
    const raw: string[] = [];
    let bytes = 0;
    let lineCount = 0;
    let truncatedByBytes = false;
    let hasMoreLines = false;
    try {
        for await (const text of rl) {
            lineCount++;
            if (lineCount <= start) continue;
            if (raw.length >= limit) { hasMoreLines = true; continue; }
            const line = text.length > MAX_LINE ? text.substring(0, MAX_LINE) + `... (line truncated to ${MAX_LINE} chars)` : text;
            const size = Buffer.byteLength(line, 'utf-8') + (raw.length > 0 ? 1 : 0);
            if (bytes + size > MAX_BYTES) { truncatedByBytes = true; hasMoreLines = true; break; }
            raw.push(line);
            bytes += size;
        }
    } finally {
        rl.close();
        stream.destroy();
    }

    if (lineCount < start && !(lineCount === 0 && start === 0)) {
        return createErrorResult(`Offset ${startLine} is out of range for this file (${lineCount} lines)`);
    }

    const lastReadLine = startLine + raw.length - 1;
    const nextOffset = lastReadLine + 1;
    const completelyRead = !hasMoreLines && !truncatedByBytes;
    // truncatedByBytes 时主流程提前 break，lineCount 不是文件总行数；其他情况下 lineCount 才等于总数
    const totalKnown = totalHint != null || !truncatedByBytes;
    const total = totalHint ?? lineCount;

    const parts: string[] = [];

    // 前置：起点之前没有读到的行
    if (startLine > 1) {
        const before = startLine - 1;
        parts.push(`(Above: ${before} earlier line${before === 1 ? '' : 's'} (1-${before}) not read. Use mode="line" offset=1 limit=${before} to read them.)`);
    }

    parts.push(raw.join('\n'));

    // 后置：终点之后没有读到的行
    if (completelyRead) {
        parts.push(`(End of file - total ${total} lines)`);
    } else if (totalKnown) {
        const after = total - lastReadLine;
        parts.push(`(Below: ${after} more line${after === 1 ? '' : 's'} (${nextOffset}-${total}) not read. Use mode="line" offset=${nextOffset} to continue.)`);
    } else {
        parts.push(`(Below: output capped at ${MAX_BYTES / 1024}KB after reading lines ${startLine}-${lastReadLine}; more lines follow, total unknown. Use mode="line" offset=${nextOffset} to continue.)`);
    }

    return createSuccessResult(createTextContent(parts.join('\n\n')));
}

async function readByBytes(abs: string, position: number, want: number, fileSize: number): Promise<MCPToolResult> {
    if (position > fileSize) {
        return createErrorResult(`Byte offset ${position} is past end of file (size ${fileSize})`);
    }
    let text: string;
    let bytesRead: number;
    const fh = await fsAsync.open(abs, 'r');
    try {
        const buf = Buffer.alloc(want);
        ({ bytesRead } = await fh.read(buf, 0, want, position));
        // 对齐 UTF-8 字符边界，避免半截多字节字符
        let s = 0, e = bytesRead;
        while (s < e && (buf[s] & 0xC0) === 0x80) s++;
        while (e > s && (buf[e - 1] & 0xC0) === 0x80) e--;
        text = buf.subarray(s, e).toString('utf8');
    } finally {
        await fh.close();
    }

    const nextPos = position + bytesRead;
    const parts: string[] = [];

    // 前置：起点之前未读的字节
    if (position > 0) {
        parts.push(`(Above: ${position} earlier byte${position === 1 ? '' : 's'} (0-${position - 1}) not read. Use mode="byte" offset=0 limit=${position} to read them.)`);
    }

    parts.push(text);

    // 后置：终点之后未读的字节
    if (nextPos >= fileSize) {
        parts.push(`(End of file at byte ${fileSize})`);
    } else {
        const after = fileSize - nextPos;
        parts.push(`(Below: ${after} more byte${after === 1 ? '' : 's'} (${nextPos}-${fileSize - 1}) not read. Use mode="byte" offset=${nextPos} to continue.)`);
    }

    return createSuccessResult(createTextContent(parts.join('\n\n')));
}

/** 读取文件，支持 line/byte 模式以及从末尾计数（endLine/endByte） */
export function createReadTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'read',
        description: loadPrompt('tools/fs/read.txt'),
        schema: z.object({
            filePath: z.string().describe('Absolute path to the file'),
            mode: z.enum(ReadMode).optional()
                .describe('line/byte: from start. endLine/endByte: from EOF. Default "line".'),
            offset: z.number().int().min(0).optional()
                .describe('line: 1-indexed start line. byte: 0-indexed start byte. endLine/endByte: distance from EOF where read starts (defaults to limit so "last N" works with just limit).'),
            limit: z.number().int().positive().optional()
                .describe(`Max lines (line/endLine, default ${DEFAULT_LINE_LIMIT}) or max bytes (byte/endByte, capped at ${MAX_BYTES / 1024}KB).`),
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

                if (m === ReadMode.Byte || m === ReadMode.EndByte) {
                    const want = Math.min(limit ?? DEFAULT_BYTE_LIMIT, MAX_BYTES);
                    const position = m === ReadMode.EndByte
                        ? Math.max(0, stat.size - (offset ?? want))
                        : (offset ?? 0);
                    return readByBytes(abs, position, want, stat.size);
                }

                const lim = limit ?? DEFAULT_LINE_LIMIT;
                let startLine: number;
                let totalHint: number | undefined;
                if (m === ReadMode.EndLine) {
                    totalHint = await countLines(abs);
                    startLine = Math.max(1, totalHint - (offset ?? lim) + 1);
                } else {
                    startLine = offset ?? 1;
                }
                return readByLines(abs, startLine, lim, totalHint);
            } catch (e: any) {
                logger.error(`read ${filePath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}
