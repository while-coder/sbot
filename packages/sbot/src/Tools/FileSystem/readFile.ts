import fs from 'fs';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { FileSystemToolsConfig } from './config';
import { checkFile, headFile, tailFile, formatSize } from './utils';

const logger = LoggerService.getLogger('Tools/FileSystem/readFile.ts');

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
