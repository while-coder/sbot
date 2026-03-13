import fs from 'fs';
import fsAsync from 'fs/promises';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { FileSystemToolsConfig } from '../config';
import { checkFile, formatSize, normalizeLineEndings } from '../utils';

const logger = LoggerService.getLogger('Tools/FileSystem/content/readFile.ts');

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
            const chunk = normalizeLineEndings(buf.subarray(0, bytesRead).toString('utf-8')) + remaining;
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

/** 读取文件内容（支持 head/tail 大文件截取）*/
export function createReadFileTool(config: FileSystemToolsConfig = { maxFileSize: 10 * 1024 * 1024 }): StructuredToolInterface {
    const maxSize = config.maxFileSize;
    return new DynamicStructuredTool({
        name: 'read_file',
        description: `Reads the content of a local file. Path must be absolute.
Use the head or tail parameters to read only the first or last N lines of large files, avoiding size limit errors.`,
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
