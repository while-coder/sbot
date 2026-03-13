import fs from 'fs';
import path from 'path';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { FileSystemToolsConfig } from '../config';
import { checkDir, globToRegex } from '../utils';

const logger = LoggerService.getLogger('Tools/FileSystem/content/grepFiles.ts');

/** grep 跨文件内容搜索 */
export function createGrepFilesTool(config: FileSystemToolsConfig = { maxFileSize: 10 * 1024 * 1024 }): StructuredToolInterface {
    const maxSize = config.maxFileSize;
    return new DynamicStructuredTool({
        name: 'grep_files',
        description: `Searches for files containing specific text across a directory (like grep -r). Returns matching files with line numbers and content. Supports regex, file pattern filtering, and case-insensitive search. Path must be absolute.
Use search_files to find files by name pattern instead of content.`,
        schema: z.object({
            searchPath: z.string().describe('搜索目录的绝对路径'),
            searchText: z.string().describe('要搜索的文本或正则表达式'),
            filePattern: z.string().optional().default('*').describe('文件名过滤模式（如 *.js）'),
            useRegex: z.boolean().optional().default(false).describe('是否使用正则表达式'),
            caseSensitive: z.boolean().optional().default(true).describe('是否区分大小写'),
            recursive: z.boolean().optional().default(true).describe('是否递归搜索'),
            maxResults: z.number().optional().default(50).describe('最大返回文件数，默认 50'),
            includeHidden: z.boolean().optional().default(false).describe('是否包含隐藏文件'),
        }) as any,
        func: async ({ searchPath, searchText, filePattern = '*', useRegex = false, caseSensitive = true, recursive = true, maxResults = 50, includeHidden = false }: any): Promise<MCPToolResult> => {
            try {
                const abs = checkDir(searchPath);
                const fileRegex = globToRegex(filePattern);
                const searchRegex = useRegex ? new RegExp(searchText, caseSensitive ? '' : 'i') : null;
                const searchLower = caseSensitive ? searchText : searchText.toLowerCase();
                const results: Array<{ path: string; name: string; matches: Array<{ line: number; content: string }>; totalMatches: number }> = [];
                function searchInFile(fp: string): Array<{ line: number; content: string }> {
                    try {
                        if (fs.statSync(fp).size > maxSize) return [];
                        return fs.readFileSync(fp, 'utf8').split('\n').reduce((acc, line, i) => {
                            const hit = searchRegex
                                ? searchRegex.test(line)
                                : (caseSensitive ? line : line.toLowerCase()).includes(searchLower);
                            if (hit) acc.push({ line: i + 1, content: line });
                            return acc;
                        }, [] as Array<{ line: number; content: string }>);
                    } catch { return []; }
                }
                function walk(dir: string) {
                    if (results.length >= maxResults) return;
                    try {
                        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                            if (results.length >= maxResults) break;
                            if (!includeHidden && entry.name.startsWith('.')) continue;
                            const full = path.join(dir, entry.name);
                            if (entry.isFile() && fileRegex.test(entry.name)) {
                                const m = searchInFile(full);
                                if (m.length > 0) results.push({ path: full, name: entry.name, matches: m.slice(0, 10), totalMatches: m.length });
                            }
                            if (recursive && entry.isDirectory()) walk(full);
                        }
                    } catch (e: any) { logger.warn(`Cannot access ${dir}: ${e.message}`); }
                }
                walk(abs);
                return createSuccessResult(createTextContent(JSON.stringify(results, null, 2)));
            } catch (e: any) {
                logger.error(`grep_files ${searchPath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}
