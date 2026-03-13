import fs from 'fs';
import path from 'path';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { checkFile, resolvePath } from './utils';

const logger = LoggerService.getLogger('Tools/FileSystem/copyFile.ts');

/** 复制文件 */
export function createCopyFileTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'copy_file',
        description: '复制文件。源路径和目标路径都必须是绝对路径。',
        schema: z.object({
            sourcePath: z.string().describe('源文件的绝对路径'),
            destPath: z.string().describe('目标文件的绝对路径'),
            overwrite: z.boolean().optional().default(false).describe('目标已存在时是否覆盖，默认 false'),
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
