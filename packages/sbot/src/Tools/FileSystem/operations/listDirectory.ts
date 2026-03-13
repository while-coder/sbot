import fs from 'fs';
import path from 'path';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { checkDir, formatSize } from '../utils';

const logger = LoggerService.getLogger('Tools/FileSystem/operations/listDirectory.ts');

/** 列出目录内容（含文件大小）*/
export function createListDirectoryTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'list_directory',
        description: '列出目录下的文件和子目录，包含文件大小信息。可递归列出子目录。路径必须是绝对路径。',
        schema: z.object({
            dirPath: z.string().describe('目录的绝对路径'),
            recursive: z.boolean().optional().default(false).describe('是否递归列出子目录，默认 false'),
            includeHidden: z.boolean().optional().default(false).describe('是否包含隐藏文件，默认 false'),
        }) as any,
        func: async ({ dirPath, recursive = false, includeHidden = false }: any): Promise<MCPToolResult> => {
            try {
                const abs = checkDir(dirPath);
                function read(cur: string): any[] {
                    return fs.readdirSync(cur, { withFileTypes: true })
                        .filter(e => includeHidden || !e.name.startsWith('.'))
                        .map(e => {
                            const full = path.join(cur, e.name);
                            if (e.isDirectory()) {
                                const item: any = { name: e.name, type: 'directory', path: full };
                                if (recursive) item.children = read(full);
                                return item;
                            }
                            const s = fs.statSync(full);
                            return { name: e.name, type: 'file', path: full, size: s.size, sizeFormatted: formatSize(s.size), modified: s.mtime };
                        });
                }
                return createSuccessResult(createTextContent(JSON.stringify(read(abs), null, 2)));
            } catch (e: any) {
                logger.error(`list_directory ${dirPath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}
