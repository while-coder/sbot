import fs from 'fs';
import path from 'path';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { resolvePath, writeAtomic } from '../utils';

const logger = LoggerService.getLogger('Tools/FileSystem/content/writeFile.ts');

/** 写入文件（原子替换，防止竞态条件）*/
export function createWriteFileTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'write_file',
        description: `Writes content to a file. Creates the file if it does not exist. Parent directories are created automatically by default.
Uses atomic write (temp + rename) to prevent data corruption. Path must be absolute.
Prefer edit_file for modifying existing files to avoid overwriting the entire content.`,
        schema: z.object({
            filePath: z.string().describe('要写入的文件的绝对路径'),
            content: z.string().describe('要写入的文件内容'),
            encoding: z.enum(['utf8', 'utf-8', 'ascii']).optional().default('utf8').describe('文件编码，默认 utf8'),
            createDirs: z.boolean().optional().default(true).describe('目录不存在时是否自动创建，默认 true'),
        }) as any,
        func: async ({ filePath, content, encoding = 'utf8', createDirs = true }: any): Promise<MCPToolResult> => {
            try {
                const abs = resolvePath(filePath);
                const dir = path.dirname(abs);
                if (createDirs && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                await writeAtomic(abs, content, encoding as BufferEncoding);
                return createSuccessResult(createTextContent(`文件写入成功: ${abs}`));
            } catch (e: any) {
                logger.error(`write_file ${filePath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}
