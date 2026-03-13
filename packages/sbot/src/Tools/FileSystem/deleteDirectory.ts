import fs from 'fs';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { checkDir } from './utils';

const logger = LoggerService.getLogger('Tools/FileSystem/deleteDirectory.ts');

/** 删除目录 */
export function createDeleteDirectoryTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'delete_directory',
        description: '删除目录及其所有内容。此操作不可逆！路径必须是绝对路径。',
        schema: z.object({
            dirPath: z.string().describe('要删除的目录的绝对路径'),
            recursive: z.boolean().optional().default(true).describe('是否递归删除，默认 true'),
        }) as any,
        func: async ({ dirPath, recursive = true }: any): Promise<MCPToolResult> => {
            try {
                const abs = checkDir(dirPath);
                fs.rmSync(abs, { recursive, force: true });
                return createSuccessResult(createTextContent(`目录删除成功: ${abs}`));
            } catch (e: any) {
                logger.error(`delete_directory ${dirPath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}
