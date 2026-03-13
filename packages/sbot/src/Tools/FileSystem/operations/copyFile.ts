import fs from 'fs';
import path from 'path';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { checkFile, resolvePath } from '../utils';

const logger = LoggerService.getLogger('Tools/FileSystem/operations/copyFile.ts');

/** Copy a file */
export function createCopyFileTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'copy_file',
        description: 'Copy a file. Both source and destination paths must be absolute.',
        schema: z.object({
            sourcePath: z.string().describe('Absolute path of the source file'),
            destPath: z.string().describe('Absolute path of the destination file'),
            overwrite: z.boolean().optional().default(false).describe('Whether to overwrite if destination exists, default false'),
        }) as any,
        func: async ({ sourcePath, destPath, overwrite = false }: any): Promise<MCPToolResult> => {
            try {
                const { abs: src } = checkFile(sourcePath);
                const dst = resolvePath(destPath);
                if (fs.existsSync(dst) && !overwrite) return createErrorResult(`目标文件已存在: ${dst}（设置 overwrite=true 可覆盖）`);
                const destDir = path.dirname(dst);
                if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
                fs.copyFileSync(src, dst);
                return createSuccessResult(createTextContent(`复制成功: ${src} -> ${dst}`));
            } catch (e: any) {
                logger.error(`copy_file ${sourcePath} -> ${destPath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}
