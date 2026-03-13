import fs from 'fs';
import path from 'path';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { checkDir, globToRegex, formatSize } from './utils';

const logger = LoggerService.getLogger('Tools/FileSystem/searchFiles.ts');

/** 按文件名模式搜索文件 */
export function createSearchFilesTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'search_files',
        description: '按文件名模式搜索文件，支持通配符（* 和 ?）。搜索路径必须是绝对路径。',
        schema: z.object({
            searchPath: z.string().describe('搜索目录的绝对路径'),
            pattern: z.string().describe('文件名匹配模式（如 *.js, test?.txt）'),
            recursive: z.boolean().optional().default(true).describe('是否递归搜索子目录，默认 true'),
            maxResults: z.number().optional().default(100).describe('最大返回数，默认 100'),
            includeHidden: z.boolean().optional().default(false).describe('是否包含隐藏文件'),
        }) as any,
        func: async ({ searchPath, pattern, recursive = true, maxResults = 100, includeHidden = false }: any): Promise<MCPToolResult> => {
            try {
                const abs = checkDir(searchPath);
                const regex = globToRegex(pattern);
                const results: Array<{ path: string; name: string; size: number; sizeFormatted: string; modified: Date }> = [];
                function walk(dir: string) {
                    if (results.length >= maxResults) return;
                    try {
                        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                            if (results.length >= maxResults) break;
                            if (!includeHidden && entry.name.startsWith('.')) continue;
                            const full = path.join(dir, entry.name);
                            if (entry.isFile() && regex.test(entry.name)) {
                                const s = fs.statSync(full);
                                results.push({ path: full, name: entry.name, size: s.size, sizeFormatted: formatSize(s.size), modified: s.mtime });
                            }
                            if (recursive && entry.isDirectory()) walk(full);
                        }
                    } catch (e: any) { logger.warn(`Cannot access ${dir}: ${e.message}`); }
                }
                walk(abs);
                return createSuccessResult(createTextContent(JSON.stringify(results, null, 2)));
            } catch (e: any) {
                logger.error(`search_files ${searchPath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}
