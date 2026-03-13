import fs from 'fs';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { FileSystemToolsConfig } from '../config';
import { checkFile, formatSize } from '../utils';

const logger = LoggerService.getLogger('Tools/FileSystem/content/readFileLines.ts');

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
