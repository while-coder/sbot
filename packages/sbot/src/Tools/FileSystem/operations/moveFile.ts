import fs from 'fs';
import path from 'path';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { resolvePath } from '../utils';

const logger = LoggerService.getLogger('Tools/FileSystem/operations/moveFile.ts');

/** Move or rename a file or directory */
export function createMoveFileTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'move_file',
        description: 'Move or rename a file/directory. Both source and destination paths must be absolute.',
        schema: z.object({
            sourcePath: z.string().describe('Absolute path of the source file or directory'),
            destPath: z.string().describe('Absolute path of the destination'),
            overwrite: z.boolean().optional().default(false).describe('Whether to overwrite if destination exists, default false'),
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
