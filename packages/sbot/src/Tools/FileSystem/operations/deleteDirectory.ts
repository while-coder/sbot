import fs from 'fs';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { checkDir } from '../utils';

const logger = LoggerService.getLogger('Tools/FileSystem/operations/deleteDirectory.ts');

/** Delete a directory */
export function createDeleteDirectoryTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'delete_directory',
        description: 'Delete a directory and all its contents. This operation is irreversible! Path must be absolute.',
        schema: z.object({
            dirPath: z.string().describe('Absolute path of the directory to delete'),
            recursive: z.boolean().optional().default(true).describe('Whether to delete recursively, default true'),
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
