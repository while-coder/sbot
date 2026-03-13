import fs from 'fs';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { checkFile } from '../utils';

const logger = LoggerService.getLogger('Tools/FileSystem/operations/deleteFile.ts');

/** 删除文件 */
export function createDeleteFileTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'delete_file',
        description: `Deletes a file. This operation is irreversible. Path must be absolute.`,
        schema: z.object({ filePath: z.string().describe('要删除的文件的绝对路径') }) as any,
        func: async ({ filePath }: any): Promise<MCPToolResult> => {
            try {
                const { abs } = checkFile(filePath);
                fs.unlinkSync(abs);
                return createSuccessResult(createTextContent(`文件删除成功: ${abs}`));
            } catch (e: any) {
                logger.error(`delete_file ${filePath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}
