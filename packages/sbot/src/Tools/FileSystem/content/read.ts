import fs from 'fs';
import fsAsync from 'fs/promises';
import path from 'path';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { resolvePath, normalizeLineEndings } from '../utils';

const logger = LoggerService.getLogger('Tools/FileSystem/content/read.ts');

const DEFAULT_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`;
const MAX_BYTES = 50 * 1024;
const MAX_BYTES_LABEL = `${MAX_BYTES / 1024}KB`;

const BINARY_EXTS = new Set([
    '.zip', '.tar', '.gz', '.exe', '.dll', '.so', '.class', '.jar', '.war',
    '.7z', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods',
    '.odp', '.bin', '.dat', '.obj', '.o', '.a', '.lib', '.wasm', '.pyc', '.pyo',
]);

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

async function tailLines(filepath: string, numLines: number): Promise<string[]> {
    const CHUNK = 1024;
    const stats = await fsAsync.stat(filepath);
    if (stats.size === 0) return [];
    const fh = await fsAsync.open(filepath, 'r');
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
            const chunk = normalizeLineEndings(buf.subarray(0, bytesRead).toString('utf-8')) + remaining;
            const parts = chunk.split('\n');
            if (position > 0) remaining = parts.shift()!;
            for (let i = parts.length - 1; i >= 0 && linesFound < numLines; i--) {
                lines.unshift(parts[i]);
                linesFound++;
            }
        }
        return lines;
    } finally {
        await fh.close();
    }
}

/** 读取文件或目录，带行号、分页、二进制检测、"Did you mean?" 提示 */
export function createReadTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'read',
        description: `Reads a text file and returns its content with line numbers in the format "line_number: line_content". Default ${DEFAULT_LIMIT} lines per call, capped at ${MAX_BYTES_LABEL} of output. Path must be absolute.
- Use offset + limit to paginate through large files.
- Use tail to efficiently read the last N lines (mutually exclusive with offset/limit).
- Returns "Did you mean?" suggestions when the file is not found.
- Automatically detects and rejects binary files; use read_binary_file for binary files.
- Use ls to list directory contents instead of reading a directory path.`,
        schema: z.object({
            filePath: z.string().describe('Absolute path to the file'),
            offset: z.number().int().min(1).optional().describe('Line number to start reading from (1-indexed), default 1'),
            limit: z.number().int().positive().optional().describe(`Max lines to read, default ${DEFAULT_LIMIT}`),
            tail: z.number().int().positive().optional().describe('Read the last N lines (mutually exclusive with offset/limit)'),
        }) as any,
        func: async ({ filePath, offset, limit, tail }: any): Promise<MCPToolResult> => {
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

                // Binary check
                if (await isBinaryFile(abs, stat.size)) {
                    return createErrorResult(`Cannot read binary file: ${abs}`);
                }

                // Tail mode
                if (tail) {
                    const lines = await tailLines(abs, tail);
                    const output = `<path>${abs}</path>\n<type>file</type>\n<content>\n${lines.join('\n')}\n\n(Last ${lines.length} lines)\n</content>`;
                    return createSuccessResult(createTextContent(output));
                }

                // Stream with line numbers + byte cap
                const lim = limit ?? DEFAULT_LIMIT;
                const start = (offset ?? 1) - 1;
                const stream = createReadStream(abs, { encoding: 'utf8' });
                const rl = createInterface({ input: stream, crlfDelay: Infinity });

                const raw: string[] = [];
                let bytes = 0;
                let lineCount = 0;
                let truncatedByBytes = false;
                let hasMoreLines = false;

                try {
                    for await (const text of rl) {
                        lineCount++;
                        if (lineCount <= start) continue;
                        if (raw.length >= lim) { hasMoreLines = true; continue; }
                        const line = text.length > MAX_LINE_LENGTH ? text.substring(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX : text;
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
                    return createErrorResult(`Offset ${offset} is out of range for this file (${lineCount} lines)`);
                }

                const off = offset ?? 1;
                const content = raw.map((line, i) => `${i + off}: ${line}`).join('\n');
                const lastReadLine = off + raw.length - 1;
                const nextOffset = lastReadLine + 1;

                let output = `<path>${abs}</path>\n<type>file</type>\n<content>\n${content}`;
                if (truncatedByBytes) {
                    output += `\n\n(Output capped at ${MAX_BYTES_LABEL}. Showing lines ${off}-${lastReadLine}. Use offset=${nextOffset} to continue.)`;
                } else if (hasMoreLines) {
                    output += `\n\n(Showing lines ${off}-${lastReadLine} of ${lineCount}. Use offset=${nextOffset} to continue.)`;
                } else {
                    output += `\n\n(End of file - total ${lineCount} lines)`;
                }
                output += '\n</content>';

                return createSuccessResult(createTextContent(output));
            } catch (e: any) {
                logger.error(`read ${filePath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}
