import fs from 'fs';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { resolvePath } from './utils';

const logger = LoggerService.getLogger('Tools/FileSystem/createDirectory.ts');

/** 创建目录 */
export function createDirectoryTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'create_directory',
        description: '创建新目录，自动创建缺失的父目录。路径必须是绝对路径。',
        schema: z.object({
            dirPath: z.string().describe('要创建的目录的绝对路径'),
            recursive: z.boolean().optional().default(true).describe('是否递归创建父目录，默认 true'),
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
