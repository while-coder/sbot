import fs from 'fs';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { FileSystemToolsConfig } from './config';
import { checkFile, formatSize } from './utils';

const logger = LoggerService.getLogger('Tools/FileSystem/searchInFile.ts');

/** 在文件中搜索内容 */
export function createSearchInFileTool(config: FileSystemToolsConfig = { maxFileSize: 10 * 1024 * 1024 }): StructuredToolInterface {
    const maxSize = config.maxFileSize;
    return new DynamicStructuredTool({
        name: 'search_in_file',
        description: '在文件中搜索文本，返回匹配的行号和内容。路径必须是绝对路径。',
        schema: z.object({
            filePath: z.string().describe('文件的绝对路径'),
            searchText: z.string().describe('要搜索的文本或正则表达式'),
            useRegex: z.boolean().optional().default(false).describe('是否使用正则表达式'),
            caseSensitive: z.boolean().optional().default(true).describe('是否区分大小写，默认 true'),
            maxResults: z.number().optional().default(100).describe('最大返回结果数，默认 100'),
            encoding: z.enum(['utf8', 'utf-8', 'ascii']).optional().default('utf8').describe('文件编码'),
        }) as any,
        func: async ({ filePath, searchText, useRegex = false, caseSensitive = true, maxResults = 100, encoding = 'utf8' }: any): Promise<MCPToolResult> => {
            try {
                const { abs, stat } = checkFile(filePath);
                if (stat.size > maxSize) return createErrorResult(`文件过大: ${formatSize(stat.size)}`);
                const lines = fs.readFileSync(abs, encoding as BufferEncoding).toString().split('\n');
                const regex = useRegex ? new RegExp(searchText, caseSensitive ? 'g' : 'gi') : null;
                const matches: Array<{ line: number; content: string; matchPositions: number[] }> = [];
                for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
                    const line = lines[i];
                    const positions: number[] = [];
                    if (regex) {
                        regex.lastIndex = 0;
                        let m;
                        while ((m = regex.exec(line)) !== null) positions.push(m.index);
                    } else {
                        const searchIn = caseSensitive ? line : line.toLowerCase();
                        const searchFor = caseSensitive ? searchText : searchText.toLowerCase();
                        let pos = 0;
                        while ((pos = searchIn.indexOf(searchFor, pos)) !== -1) { positions.push(pos); pos += searchFor.length; }
                    }
                    if (positions.length > 0) matches.push({ line: i + 1, content: line, matchPositions: positions });
                }
                return createSuccessResult(createTextContent(JSON.stringify(matches, null, 2)));
            } catch (e: any) {
                logger.error(`search_in_file ${filePath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}
