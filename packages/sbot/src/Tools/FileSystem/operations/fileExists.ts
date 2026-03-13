import fs from 'fs';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { resolvePath, formatSize } from '../utils';

const logger = LoggerService.getLogger('Tools/FileSystem/operations/fileExists.ts');

/** 检查文件/目录是否存在（含权限信息）*/
export function createFileExistsTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'file_exists',
        description: `Checks whether a file or directory exists. Returns type (file/directory), size, timestamps, and permissions. Path must be absolute.`,
        schema: z.object({ filePath: z.string().describe('要检查的文件或目录的绝对路径') }) as any,
        func: async ({ filePath }: any): Promise<MCPToolResult> => {
            try {
                const abs = resolvePath(filePath);
                if (!fs.existsSync(abs)) {
                    return createSuccessResult(createTextContent(JSON.stringify({ exists: false, filePath: abs }, null, 2)));
                }
                const s = fs.statSync(abs);
                return createSuccessResult(createTextContent(JSON.stringify({
                    exists: true,
                    filePath: abs,
                    type: s.isFile() ? 'file' : s.isDirectory() ? 'directory' : 'other',
                    size: s.size,
                    sizeFormatted: formatSize(s.size),
                    permissions: s.mode.toString(8).slice(-3),
                    created: s.birthtime,
                    modified: s.mtime,
                    accessed: s.atime,
                }, null, 2)));
            } catch (e: any) {
                logger.error(`file_exists ${filePath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}
