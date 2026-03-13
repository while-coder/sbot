import fsAsync from 'fs/promises';
import path from 'path';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { checkFile, formatSize } from '../utils';

const logger = LoggerService.getLogger('Tools/FileSystem/content/readBinaryFile.ts');

const MAX_SIZE = 100 * 1024; // 100KB，base64 后约 133KB ≈ 3.3万 token
const MAX_SIZE_LABEL = '100KB';

/** 读取二进制文件为 base64 */
export function createReadBinaryFileTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'read_binary_file',
        description: `Reads a binary file (image, audio, PDF, etc.) and returns its content as base64. Maximum file size ${MAX_SIZE_LABEL}. Use this for non-text files. Use read for text files (source code, config, markdown, etc.). Path must be absolute.`,
        schema: z.object({
            filePath: z.string().describe('二进制文件的绝对路径'),
        }) as any,
        func: async ({ filePath }: any): Promise<MCPToolResult> => {
            try {
                const { abs, stat } = checkFile(filePath);
                if (stat.size > MAX_SIZE) return createErrorResult(`文件过大: ${formatSize(stat.size)}，上限 ${MAX_SIZE_LABEL}`);
                const base64 = (await fsAsync.readFile(abs)).toString('base64');
                const ext = path.extname(abs).toLowerCase().slice(1);
                return createSuccessResult(createTextContent(JSON.stringify({ filePath: abs, size: formatSize(stat.size), ext, base64 })));
            } catch (e: any) {
                logger.error(`read_binary_file ${filePath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}
