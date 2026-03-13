import fs from 'fs';
import path from 'path';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { resolvePath } from './utils';

const logger = LoggerService.getLogger('Tools/FileSystem/moveFile.ts');

/** 移动/重命名文件或目录 */
export function createMoveFileTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'move_file',
        description: '移动或重命名文件/目录。源路径和目标路径都必须是绝对路径。',
        schema: z.object({
            sourcePath: z.string().describe('源文件或目录的绝对路径'),
            destPath: z.string().describe('目标路径的绝对路径'),
            overwrite: z.boolean().optional().default(false).describe('目标已存在时是否覆盖，默认 false'),
        }) as any,
        func: async ({ sourcePath, destPath, overwrite = false }: any): Promise<MCPToolResult> => {
            try {
                const src = resolvePath(sourcePath);
                const dst = resolvePath(destPath);
                if (!fs.existsSync(src)) throw new Error(`源路径不存在: ${src}`);
                if (fs.existsSync(dst) && !overwrite) return createErrorResult(`目标路径已存在: ${dst}（设置 overwrite=true 可覆盖）`);
                const destDir = path.dirname(dst);
                if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
                fs.renameSync(src, dst);
                return createSuccessResult(createTextContent(`移动成功: ${src} -> ${dst}`));
            } catch (e: any) {
                logger.error(`move_file ${sourcePath} -> ${destPath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}
