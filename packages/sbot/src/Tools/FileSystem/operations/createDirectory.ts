import fs from 'fs';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { resolvePath } from '../utils';

const logger = LoggerService.getLogger('Tools/FileSystem/operations/createDirectory.ts');

/** Create a directory */
export function createDirectoryTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'create_directory',
        description: `Creates a new directory, automatically creating missing parent directories. Path must be absolute.`,
        schema: z.object({
            dirPath: z.string().describe('Absolute path of the directory to create'),
            recursive: z.boolean().optional().default(true).describe('Whether to create parent directories recursively, default true'),
        }) as any,
        func: async ({ dirPath, recursive = true }: any): Promise<MCPToolResult> => {
            try {
                const abs = resolvePath(dirPath);
                if (fs.existsSync(abs)) return createErrorResult(`目录已存在: ${abs}`);
                fs.mkdirSync(abs, { recursive });
                return createSuccessResult(createTextContent(`目录创建成功: ${abs}`));
            } catch (e: any) {
                logger.error(`create_directory ${dirPath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}
