import fsAsync from 'fs/promises';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { checkFile, formatSize } from '../utils';
import { loadPrompt } from '../../../Core/PromptLoader';

const logger = LoggerService.getLogger('Tools/FileSystem/content/readBinaryFile.ts');

const MAX_SIZE = 100 * 1024; // 100KB，base64 后约 133KB ≈ 3.3万 token
const MAX_SIZE_LABEL = '100KB';

/** 读取二进制文件为 base64 */
export function createReadBinaryFileTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'read_binary_file',
        description: loadPrompt('tools/fs/read_binary_file.txt'),
        schema: z.object({
            filePath: z.string().describe('Absolute path of the binary file'),
        }) as any,
        func: async ({ filePath }: any): Promise<MCPToolResult> => {
            try {
                const { abs, stat } = checkFile(filePath);
                if (stat.size > MAX_SIZE) return createErrorResult(`File too large: ${formatSize(stat.size)}, maximum is ${MAX_SIZE_LABEL}`);
                const base64 = (await fsAsync.readFile(abs)).toString('base64');
                return createSuccessResult(createTextContent(`size: ${formatSize(stat.size)}\nbase64: ${base64}`));
            } catch (e: any) {
                logger.error(`read_binary_file ${filePath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}
