/**
 * 文件系统工具集
 * 为 LLM 提供方便的本地文件读写操作能力
 * 注意：所有路径参数必须使用绝对路径
 */

import fs from 'fs';
import path from 'path';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from '../ToolsConfig';
import { FileSystemToolsConfig } from './config';

const logger = LoggerService.getLogger('Tools/FileSystem/index.ts');

// 配置类型已移到 config.ts
export type { FileSystemToolsConfig } from './config';

/**
 * 验证路径是否为绝对路径
 */
function validatePath(filePath: string): { valid: boolean; error?: string; absolutePath?: string } {
    // 检查是否为绝对路径
    if (!path.isAbsolute(filePath)) {
        return {
            valid: false,
            error: `路径必须是绝对路径: ${filePath}`
        };
    }

    const absolutePath = path.normalize(filePath);

    return {
        valid: true,
        absolutePath
    };
}

/**
 * 创建读取文件内容的工具
 */
export function createReadFileTool(config: FileSystemToolsConfig = { maxFileSize: 10 * 1024 * 1024 }): StructuredToolInterface {
    const maxSize = config.maxFileSize;

    return new DynamicStructuredTool({
        name: 'read_file',
        description: '读取本地文件的完整内容。支持文本文件（如 .txt, .md, .json, .js, .ts 等）。注意：路径必须是绝对路径。',
        schema: z.object({
            filePath: z.string().describe('要读取的文件的绝对路径（必须是绝对路径，如 /path/to/file.txt）'),
            encoding: z.enum(['utf8', 'utf-8', 'ascii', 'base64']).optional().default('utf8').describe('文件编码格式，默认为 utf8')
        }) as any,
        func: async ({ filePath, encoding = 'utf8' }: any): Promise<MCPToolResult> => {
            try {
                const validation = validatePath(filePath);
                if (!validation.valid) {
                    return createErrorResult(validation.error!);
                }

                const absolutePath = validation.absolutePath!;

                // 检查文件是否存在
                if (!fs.existsSync(absolutePath)) {
                    return createErrorResult(`文件不存在: ${absolutePath}`);
                }

                // 检查是否为文件
                const stat = fs.statSync(absolutePath);
                if (!stat.isFile()) {
                    return createErrorResult(`路径不是文件: ${absolutePath}`);
                }

                // 检查文件大小
                if (stat.size > maxSize) {
                    return createErrorResult(`文件过大: ${(stat.size / 1024 / 1024).toFixed(2)}MB (限制: ${(maxSize / 1024 / 1024).toFixed(2)}MB)`);
                }

                // 读取文件内容
                const content = fs.readFileSync(absolutePath, encoding as BufferEncoding);

                return createSuccessResult(
                    createTextContent(content.toString())
                );

            } catch (error: any) {
                logger.error(`Error reading file ${filePath}: ${error.message}`);
                return createErrorResult(error.message);
            }
        }
    });
}

/**
 * 创建读取文件指定行的工具
 */
export function createReadFileLinesTool(config: FileSystemToolsConfig = { maxFileSize: 10 * 1024 * 1024 }): StructuredToolInterface {
    const maxSize = config.maxFileSize;

    return new DynamicStructuredTool({
        name: 'read_file_lines',
        description: '读取文件的指定行范围。适合读取大文件的部分内容。行号从 1 开始计数。注意：路径必须是绝对路径。',
        schema: z.object({
            filePath: z.string().describe('要读取的文件的绝对路径'),
            startLine: z.number().min(1).describe('起始行号（从 1 开始）'),
            endLine: z.number().min(1).optional().describe('结束行号（可选，不指定则读取到文件末尾）'),
            encoding: z.enum(['utf8', 'utf-8', 'ascii']).optional().default('utf8').describe('文件编码格式')
        }) as any,
        func: async ({ filePath, startLine, endLine, encoding = 'utf8' }: any): Promise<MCPToolResult> => {
            try {
                const validation = validatePath(filePath);
                if (!validation.valid) {
                    return createErrorResult(validation.error!);
                }

                const absolutePath = validation.absolutePath!;

                if (!fs.existsSync(absolutePath)) {
                    return createErrorResult(`文件不存在: ${absolutePath}`);
                }

                const stat = fs.statSync(absolutePath);
                if (!stat.isFile()) {
                    return createErrorResult(`路径不是文件: ${absolutePath}`);
                }

                if (stat.size > maxSize) {
                    return createErrorResult(`文件过大: ${(stat.size / 1024 / 1024).toFixed(2)}MB`);
                }

                const content = fs.readFileSync(absolutePath, encoding as BufferEncoding);
                const lines = content.toString().split('\n');

                const actualEndLine = endLine || lines.length;

                if (startLine > lines.length) {
                    return createErrorResult(`起始行号 ${startLine} 超出文件总行数 ${lines.length}`);
                }

                const selectedLines = lines.slice(startLine - 1, actualEndLine);

                return createSuccessResult(
                    createTextContent(selectedLines.join('\n'))
                );

            } catch (error: any) {
                logger.error(`Error reading file lines ${filePath}: ${error.message}`);
                return createErrorResult(error.message);
            }
        }
    });
}

/**
 * 创建写入文件内容的工具
 */
export function createWriteFileTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'write_file',
        description: '写入内容到本地文件。如果文件不存在会自动创建，如果文件已存在会覆盖原有内容。注意：路径必须是绝对路径。',
        schema: z.object({
            filePath: z.string().describe('要写入的文件的绝对路径'),
            content: z.string().describe('要写入的文件内容'),
            encoding: z.enum(['utf8', 'utf-8', 'ascii']).optional().default('utf8').describe('文件编码格式，默认为 utf8'),
            createDirs: z.boolean().optional().default(true).describe('如果目录不存在，是否自动创建目录，默认为 true')
        }) as any,
        func: async ({ filePath, content, encoding = 'utf8', createDirs = true }: any): Promise<MCPToolResult> => {
            try {
                const validation = validatePath(filePath);
                if (!validation.valid) {
                    return createErrorResult(validation.error!);
                }

                const absolutePath = validation.absolutePath!;

                // 确保目录存在
                const dirPath = path.dirname(absolutePath);
                if (createDirs && !fs.existsSync(dirPath)) {
                    fs.mkdirSync(dirPath, { recursive: true });
                }

                // 写入文件
                fs.writeFileSync(absolutePath, content, encoding as BufferEncoding);

                return createSuccessResult(
                    createTextContent(`文件写入成功: ${absolutePath}`)
                );

            } catch (error: any) {
                logger.error(`Error writing file ${filePath}: ${error.message}`);
                return createErrorResult(error.message);
            }
        }
    });
}

/**
 * 创建追加内容到文件的工具
 */
export function createAppendFileTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'append_file',
        description: '追加内容到文件末尾。如果文件不存在会自动创建。注意：路径必须是绝对路径。',
        schema: z.object({
            filePath: z.string().describe('要追加内容的文件的绝对路径'),
            content: z.string().describe('要追加的内容'),
            encoding: z.enum(['utf8', 'utf-8', 'ascii']).optional().default('utf8').describe('文件编码格式'),
            newLine: z.boolean().optional().default(true).describe('是否在追加内容前添加换行符，默认为 true')
        }) as any,
        func: async ({ filePath, content, encoding = 'utf8', newLine = true }: any): Promise<MCPToolResult> => {
            try {
                const validation = validatePath(filePath);
                if (!validation.valid) {
                    return createErrorResult(validation.error!);
                }

                const absolutePath = validation.absolutePath!;

                // 确保目录存在
                const dirPath = path.dirname(absolutePath);
                if (!fs.existsSync(dirPath)) {
                    fs.mkdirSync(dirPath, { recursive: true });
                }

                // 如果文件存在且需要换行，先添加换行符
                const contentToAppend = (fs.existsSync(absolutePath) && newLine)
                    ? '\n' + content
                    : content;

                fs.appendFileSync(absolutePath, contentToAppend, encoding as BufferEncoding);

                return createSuccessResult(
                    createTextContent(`内容追加成功: ${absolutePath}`)
                );

            } catch (error: any) {
                logger.error(`Error appending to file ${filePath}: ${error.message}`);
                return createErrorResult(error.message);
            }
        }
    });
}

/**
 * 创建替换文件内容的工具
 */
export function createReplaceInFileTool(config: FileSystemToolsConfig = { maxFileSize: 10 * 1024 * 1024 }): StructuredToolInterface {
    const maxSize = config.maxFileSize;

    return new DynamicStructuredTool({
        name: 'replace_in_file',
        description: '替换文件中的文本内容。支持字符串替换和正则表达式替换。注意：路径必须是绝对路径。',
        schema: z.object({
            filePath: z.string().describe('要替换内容的文件的绝对路径'),
            searchText: z.string().describe('要搜索的文本或正则表达式模式'),
            replaceText: z.string().describe('替换后的文本'),
            useRegex: z.boolean().optional().default(false).describe('是否使用正则表达式，默认为 false'),
            regexFlags: z.string().optional().default('g').describe('正则表达式标志（如 g, i, m），默认为 g（全局替换）'),
            encoding: z.enum(['utf8', 'utf-8', 'ascii']).optional().default('utf8').describe('文件编码格式')
        }) as any,
        func: async ({ filePath, searchText, replaceText, useRegex = false, regexFlags = 'g', encoding = 'utf8' }: any): Promise<MCPToolResult> => {
            try {
                const validation = validatePath(filePath);
                if (!validation.valid) {
                    return createErrorResult(validation.error!);
                }

                const absolutePath = validation.absolutePath!;

                if (!fs.existsSync(absolutePath)) {
                    return createErrorResult(`文件不存在: ${absolutePath}`);
                }

                const stat = fs.statSync(absolutePath);
                if (!stat.isFile()) {
                    return createErrorResult(`路径不是文件: ${absolutePath}`);
                }

                if (stat.size > maxSize) {
                    return createErrorResult(`文件过大: ${(stat.size / 1024 / 1024).toFixed(2)}MB`);
                }

                let content = fs.readFileSync(absolutePath, encoding as BufferEncoding).toString();
                let replacedContent: string;
                let matchCount = 0;

                if (useRegex) {
                    const regex = new RegExp(searchText, regexFlags);
                    const matches = content.match(regex);
                    matchCount = matches ? matches.length : 0;
                    replacedContent = content.replace(regex, replaceText);
                } else {
                    // 计算匹配次数
                    const parts = content.split(searchText);
                    matchCount = parts.length - 1;
                    replacedContent = content.split(searchText).join(replaceText);
                }

                if (matchCount === 0) {
                    return createErrorResult(`未找到匹配的文本: ${searchText}`);
                }

                fs.writeFileSync(absolutePath, replacedContent, encoding as BufferEncoding);

                return createSuccessResult(
                    createTextContent(`文件替换成功，匹配 ${matchCount} 处`)
                );

            } catch (error: any) {
                logger.error(`Error replacing in file ${filePath}: ${error.message}`);
                return createErrorResult(error.message);
            }
        }
    });
}

/**
 * 创建在文件中搜索内容的工具
 */
export function createSearchInFileTool(config: FileSystemToolsConfig = { maxFileSize: 10 * 1024 * 1024 }): StructuredToolInterface {
    const maxSize = config.maxFileSize;

    return new DynamicStructuredTool({
        name: 'search_in_file',
        description: '在文件中搜索文本或正则表达式，返回匹配的行号和内容。注意：路径必须是绝对路径。',
        schema: z.object({
            filePath: z.string().describe('要搜索的文件的绝对路径'),
            searchText: z.string().describe('要搜索的文本或正则表达式模式'),
            useRegex: z.boolean().optional().default(false).describe('是否使用正则表达式'),
            caseSensitive: z.boolean().optional().default(true).describe('是否区分大小写，默认为 true'),
            maxResults: z.number().optional().default(100).describe('最大返回结果数，默认为 100'),
            encoding: z.enum(['utf8', 'utf-8', 'ascii']).optional().default('utf8').describe('文件编码格式')
        }) as any,
        func: async ({ filePath, searchText, useRegex = false, caseSensitive = true, maxResults = 100, encoding = 'utf8' }: any): Promise<MCPToolResult> => {
            try {
                const validation = validatePath(filePath);
                if (!validation.valid) {
                    return createErrorResult(validation.error!);
                }

                const absolutePath = validation.absolutePath!;

                if (!fs.existsSync(absolutePath)) {
                    return createErrorResult(`文件不存在: ${absolutePath}`);
                }

                const stat = fs.statSync(absolutePath);
                if (!stat.isFile()) {
                    return createErrorResult(`路径不是文件: ${absolutePath}`);
                }

                if (stat.size > maxSize) {
                    return createErrorResult(`文件过大: ${(stat.size / 1024 / 1024).toFixed(2)}MB`);
                }

                const content = fs.readFileSync(absolutePath, encoding as BufferEncoding).toString();
                const lines = content.split('\n');
                const matches: Array<{ line: number; content: string; matchPositions: number[] }> = [];

                for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
                    const line = lines[i];
                    let isMatch = false;
                    const matchPositions: number[] = [];

                    if (useRegex) {
                        const flags = caseSensitive ? 'g' : 'gi';
                        const regex = new RegExp(searchText, flags);
                        let match;
                        while ((match = regex.exec(line)) !== null) {
                            isMatch = true;
                            matchPositions.push(match.index);
                        }
                    } else {
                        const searchIn = caseSensitive ? line : line.toLowerCase();
                        const searchFor = caseSensitive ? searchText : searchText.toLowerCase();
                        let pos = 0;
                        while ((pos = searchIn.indexOf(searchFor, pos)) !== -1) {
                            isMatch = true;
                            matchPositions.push(pos);
                            pos += searchFor.length;
                        }
                    }

                    if (isMatch) {
                        matches.push({
                            line: i + 1,
                            content: line,
                            matchPositions
                        });
                    }
                }

                return createSuccessResult(
                    createTextContent(JSON.stringify(matches, null, 2))
                );

            } catch (error: any) {
                logger.error(`Error searching in file ${filePath}: ${error.message}`);
                return createErrorResult(error.message);
            }
        }
    });
}

/**
 * 创建搜索文件的工具（根据文件名）
 */
export function createSearchFilesTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'search_files',
        description: '根据文件名模式搜索文件。支持通配符匹配（* 和 ?）。注意：搜索路径必须是绝对路径。',
        schema: z.object({
            searchPath: z.string().describe('要搜索的目录的绝对路径'),
            pattern: z.string().describe('文件名匹配模式（支持 * 和 ? 通配符，如 *.js, test?.txt）'),
            recursive: z.boolean().optional().default(true).describe('是否递归搜索子目录，默认为 true'),
            maxResults: z.number().optional().default(100).describe('最大返回结果数，默认为 100'),
            includeHidden: z.boolean().optional().default(false).describe('是否包含隐藏文件')
        }) as any,
        func: async ({ searchPath, pattern, recursive = true, maxResults = 100, includeHidden = false }: any): Promise<MCPToolResult> => {
            try {
                const validation = validatePath(searchPath);
                if (!validation.valid) {
                    return createErrorResult(validation.error!);
                }

                const absolutePath = validation.absolutePath!;

                if (!fs.existsSync(absolutePath)) {
                    return createErrorResult(`目录不存在: ${absolutePath}`);
                }

                const stat = fs.statSync(absolutePath);
                if (!stat.isDirectory()) {
                    return createErrorResult(`路径不是目录: ${absolutePath}`);
                }

                // 将通配符模式转换为正则表达式
                const regexPattern = pattern
                    .replace(/\./g, '\\.')
                    .replace(/\*/g, '.*')
                    .replace(/\?/g, '.');
                const regex = new RegExp(`^${regexPattern}$`, 'i');

                const results: Array<{ path: string; name: string; size: number; modified: Date }> = [];

                function searchDirectory(dirPath: string) {
                    if (results.length >= maxResults) return;

                    try {
                        const entries = fs.readdirSync(dirPath, { withFileTypes: true });

                        for (const entry of entries) {
                            if (results.length >= maxResults) break;

                            // 跳过隐藏文件
                            if (!includeHidden && entry.name.startsWith('.')) continue;

                            const fullPath = path.join(dirPath, entry.name);

                            if (entry.isFile() && regex.test(entry.name)) {
                                const stat = fs.statSync(fullPath);
                                results.push({
                                    path: fullPath,
                                    name: entry.name,
                                    size: stat.size,
                                    modified: stat.mtime
                                });
                            }

                            if (recursive && entry.isDirectory()) {
                                searchDirectory(fullPath);
                            }
                        }
                    } catch (error: any) {
                        // 忽略权限错误等，继续搜索其他目录
                        logger.warn(`Cannot access directory ${dirPath}: ${error.message}`);
                    }
                }

                searchDirectory(absolutePath);

                return createSuccessResult(
                    createTextContent(JSON.stringify(results, null, 2))
                );

            } catch (error: any) {
                logger.error(`Error searching files in ${searchPath}: ${error.message}`);
                return createErrorResult(error.message);
            }
        }
    });
}

/**
 * 创建根据内容搜索文件的工具（类似 grep -r）
 */
export function createGrepFilesTool(config: FileSystemToolsConfig = { maxFileSize: 10 * 1024 * 1024 }): StructuredToolInterface {
    const maxSize = config.maxFileSize;

    return new DynamicStructuredTool({
        name: 'grep_files',
        description: '在目录中搜索包含指定文本的文件（类似 grep -r）。注意：搜索路径必须是绝对路径。',
        schema: z.object({
            searchPath: z.string().describe('要搜索的目录的绝对路径'),
            searchText: z.string().describe('要搜索的文本或正则表达式'),
            filePattern: z.string().optional().default('*').describe('文件名过滤模式（如 *.js, *.txt）'),
            useRegex: z.boolean().optional().default(false).describe('是否使用正则表达式'),
            caseSensitive: z.boolean().optional().default(true).describe('是否区分大小写'),
            recursive: z.boolean().optional().default(true).describe('是否递归搜索子目录'),
            maxResults: z.number().optional().default(50).describe('最大返回文件数，默认为 50'),
            includeHidden: z.boolean().optional().default(false).describe('是否包含隐藏文件')
        }) as any,
        func: async ({ searchPath, searchText, filePattern = '*', useRegex = false, caseSensitive = true, recursive = true, maxResults = 50, includeHidden = false }: any): Promise<MCPToolResult> => {
            try {
                const validation = validatePath(searchPath);
                if (!validation.valid) {
                    return createErrorResult(validation.error!);
                }

                const absolutePath = validation.absolutePath!;

                if (!fs.existsSync(absolutePath)) {
                    return createErrorResult(`目录不存在: ${absolutePath}`);
                }

                const stat = fs.statSync(absolutePath);
                if (!stat.isDirectory()) {
                    return createErrorResult(`路径不是目录: ${absolutePath}`);
                }

                // 文件名过滤器
                const fileRegexPattern = filePattern
                    .replace(/\./g, '\\.')
                    .replace(/\*/g, '.*')
                    .replace(/\?/g, '.');
                const fileRegex = new RegExp(`^${fileRegexPattern}$`, 'i');

                const results: Array<{
                    path: string;
                    name: string;
                    matches: Array<{ line: number; content: string }>;
                    totalMatches: number;
                }> = [];

                function searchInFile(filePath: string): Array<{ line: number; content: string }> {
                    try {
                        const stat = fs.statSync(filePath);
                        if (stat.size > maxSize) return [];

                        const content = fs.readFileSync(filePath, 'utf8');
                        const lines = content.split('\n');
                        const matches: Array<{ line: number; content: string }> = [];

                        for (let i = 0; i < lines.length; i++) {
                            const line = lines[i];
                            let isMatch = false;

                            if (useRegex) {
                                const flags = caseSensitive ? '' : 'i';
                                const regex = new RegExp(searchText, flags);
                                isMatch = regex.test(line);
                            } else {
                                const searchIn = caseSensitive ? line : line.toLowerCase();
                                const searchFor = caseSensitive ? searchText : searchText.toLowerCase();
                                isMatch = searchIn.includes(searchFor);
                            }

                            if (isMatch) {
                                matches.push({
                                    line: i + 1,
                                    content: line
                                });
                            }
                        }

                        return matches;
                    } catch (error) {
                        return [];
                    }
                }

                function searchDirectory(dirPath: string) {
                    if (results.length >= maxResults) return;

                    try {
                        const entries = fs.readdirSync(dirPath, { withFileTypes: true });

                        for (const entry of entries) {
                            if (results.length >= maxResults) break;

                            if (!includeHidden && entry.name.startsWith('.')) continue;

                            const fullPath = path.join(dirPath, entry.name);

                            if (entry.isFile() && fileRegex.test(entry.name)) {
                                const matches = searchInFile(fullPath);
                                if (matches.length > 0) {
                                    results.push({
                                        path: fullPath,
                                        name: entry.name,
                                        matches: matches.slice(0, 10), // 每个文件最多返回 10 个匹配
                                        totalMatches: matches.length
                                    });
                                }
                            }

                            if (recursive && entry.isDirectory()) {
                                searchDirectory(fullPath);
                            }
                        }
                    } catch (error: any) {
                        logger.warn(`Cannot access directory ${dirPath}: ${error.message}`);
                    }
                }

                searchDirectory(absolutePath);

                return createSuccessResult(
                    createTextContent(JSON.stringify(results, null, 2))
                );

            } catch (error: any) {
                logger.error(`Error grepping files in ${searchPath}: ${error.message}`);
                return createErrorResult(error.message);
            }
        }
    });
}

/**
 * 创建列出目录内容的工具
 */
export function createListDirectoryTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'list_directory',
        description: '列出目录下的文件和子目录。可以递归列出所有子目录内容。注意：路径必须是绝对路径。',
        schema: z.object({
            dirPath: z.string().describe('要列出的目录的绝对路径'),
            recursive: z.boolean().optional().default(false).describe('是否递归列出子目录，默认为 false'),
            includeHidden: z.boolean().optional().default(false).describe('是否包含隐藏文件（以 . 开头），默认为 false')
        }) as any,
        func: async ({ dirPath, recursive = false, includeHidden = false }: any): Promise<MCPToolResult> => {
            try {
                const validation = validatePath(dirPath);
                if (!validation.valid) {
                    return createErrorResult(validation.error!);
                }

                const absolutePath = validation.absolutePath!;

                if (!fs.existsSync(absolutePath)) {
                    return createErrorResult(`目录不存在: ${absolutePath}`);
                }

                const stat = fs.statSync(absolutePath);
                if (!stat.isDirectory()) {
                    return createErrorResult(`路径不是目录: ${absolutePath}`);
                }

                // 递归读取目录结构
                const readDirectory = (currentPath: string): any[] => {
                    const items: any[] = [];
                    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

                    entries.forEach((entry) => {
                        // 过滤隐藏文件
                        if (!includeHidden && entry.name.startsWith('.')) {
                            return;
                        }

                        const fullPath = path.join(currentPath, entry.name);

                        if (entry.isDirectory()) {
                            const item: any = {
                                name: entry.name,
                                type: 'directory',
                                path: fullPath
                            };

                            if (recursive) {
                                item.children = readDirectory(fullPath);
                            }

                            items.push(item);
                        } else {
                            const fileStat = fs.statSync(fullPath);
                            items.push({
                                name: entry.name,
                                type: 'file',
                                path: fullPath,
                                size: fileStat.size,
                                modified: fileStat.mtime
                            });
                        }
                    });

                    return items;
                };

                const items = readDirectory(absolutePath);

                return createSuccessResult(
                    createTextContent(JSON.stringify(items, null, 2))
                );

            } catch (error: any) {
                logger.error(`Error listing directory ${dirPath}: ${error.message}`);
                return createErrorResult(error.message);
            }
        }
    });
}

/**
 * 创建删除文件的工具
 */
export function createDeleteFileTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'delete_file',
        description: '删除指定的文件。注意：此操作不可逆！路径必须是绝对路径。',
        schema: z.object({
            filePath: z.string().describe('要删除的文件的绝对路径')
        }) as any,
        func: async ({ filePath }: any): Promise<MCPToolResult> => {
            try {
                const validation = validatePath(filePath);
                if (!validation.valid) {
                    return createErrorResult(validation.error!);
                }

                const absolutePath = validation.absolutePath!;

                if (!fs.existsSync(absolutePath)) {
                    return createErrorResult(`文件不存在: ${absolutePath}`);
                }

                const stat = fs.statSync(absolutePath);
                if (!stat.isFile()) {
                    return createErrorResult(`路径不是文件: ${absolutePath}`);
                }

                fs.unlinkSync(absolutePath);

                return createSuccessResult(
                    createTextContent(`文件删除成功: ${absolutePath}`)
                );

            } catch (error: any) {
                logger.error(`Error deleting file ${filePath}: ${error.message}`);
                return createErrorResult(error.message);
            }
        }
    });
}

/**
 * 创建检查文件/目录是否存在的工具
 */
export function createFileExistsTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'file_exists',
        description: '检查文件或目录是否存在，并返回详细信息（类型、大小、修改时间等）。注意：路径必须是绝对路径。',
        schema: z.object({
            filePath: z.string().describe('要检查的文件或目录的绝对路径')
        }) as any,
        func: async ({ filePath }: any): Promise<MCPToolResult> => {
            try {
                const validation = validatePath(filePath);
                if (!validation.valid) {
                    return createErrorResult(validation.error!);
                }

                const absolutePath = validation.absolutePath!;

                if (!fs.existsSync(absolutePath)) {
                    return createSuccessResult(
                        createTextContent(JSON.stringify({ exists: false, filePath: absolutePath }, null, 2))
                    );
                }

                const stat = fs.statSync(absolutePath);
                const fileType = stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other';
                const fileInfo = {
                    exists: true,
                    filePath: absolutePath,
                    type: fileType,
                    size: stat.size,
                    created: stat.birthtime,
                    modified: stat.mtime,
                    accessed: stat.atime
                };

                return createSuccessResult(
                    createTextContent(JSON.stringify(fileInfo, null, 2))
                );

            } catch (error: any) {
                logger.error(`Error checking file ${filePath}: ${error.message}`);
                return createErrorResult(error.message);
            }
        }
    });
}

/**
 * 创建目录的工具
 */
export function createDirectoryTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'create_directory',
        description: '创建新目录。如果父目录不存在会自动创建。注意：路径必须是绝对路径。',
        schema: z.object({
            dirPath: z.string().describe('要创建的目录的绝对路径'),
            recursive: z.boolean().optional().default(true).describe('是否递归创建父目录，默认为 true')
        }) as any,
        func: async ({ dirPath, recursive = true }: any): Promise<MCPToolResult> => {
            try {
                const validation = validatePath(dirPath);
                if (!validation.valid) {
                    return createErrorResult(validation.error!);
                }

                const absolutePath = validation.absolutePath!;

                if (fs.existsSync(absolutePath)) {
                    return createErrorResult(`目录已存在: ${absolutePath}`);
                }

                fs.mkdirSync(absolutePath, { recursive });

                return createSuccessResult(
                    createTextContent(`目录创建成功: ${absolutePath}`)
                );

            } catch (error: any) {
                logger.error(`Error creating directory ${dirPath}: ${error.message}`);
                return createErrorResult(error.message);
            }
        }
    });
}

/**
 * 删除目录的工具
 */
export function createDeleteDirectoryTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'delete_directory',
        description: '删除目录及其所有内容。注意：此操作不可逆！路径必须是绝对路径。',
        schema: z.object({
            dirPath: z.string().describe('要删除的目录的绝对路径'),
            recursive: z.boolean().optional().default(true).describe('是否递归删除所有内容，默认为 true')
        }) as any,
        func: async ({ dirPath, recursive = true }: any): Promise<MCPToolResult> => {
            try {
                const validation = validatePath(dirPath);
                if (!validation.valid) {
                    return createErrorResult(validation.error!);
                }

                const absolutePath = validation.absolutePath!;

                if (!fs.existsSync(absolutePath)) {
                    return createErrorResult(`目录不存在: ${absolutePath}`);
                }

                const stat = fs.statSync(absolutePath);
                if (!stat.isDirectory()) {
                    return createErrorResult(`路径不是目录: ${absolutePath}`);
                }

                fs.rmSync(absolutePath, { recursive, force: true });

                return createSuccessResult(
                    createTextContent(`目录删除成功: ${absolutePath}`)
                );

            } catch (error: any) {
                logger.error(`Error deleting directory ${dirPath}: ${error.message}`);
                return createErrorResult(error.message);
            }
        }
    });
}

/**
 * 移动/重命名文件或目录的工具
 */
export function createMoveFileTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'move_file',
        description: '移动或重命名文件/目录。注意：源路径和目标路径都必须是绝对路径。',
        schema: z.object({
            sourcePath: z.string().describe('源文件或目录的绝对路径'),
            destPath: z.string().describe('目标路径的绝对路径'),
            overwrite: z.boolean().optional().default(false).describe('如果目标已存在是否覆盖，默认为 false')
        }) as any,
        func: async ({ sourcePath, destPath, overwrite = false }: any): Promise<MCPToolResult> => {
            try {
                const sourceValidation = validatePath(sourcePath);
                if (!sourceValidation.valid) {
                    return createErrorResult(`源路径: ${sourceValidation.error}`);
                }

                const destValidation = validatePath(destPath);
                if (!destValidation.valid) {
                    return createErrorResult(`目标路径: ${destValidation.error}`);
                }

                const absoluteSource = sourceValidation.absolutePath!;
                const absoluteDest = destValidation.absolutePath!;

                if (!fs.existsSync(absoluteSource)) {
                    return createErrorResult(`源路径不存在: ${absoluteSource}`);
                }

                if (fs.existsSync(absoluteDest) && !overwrite) {
                    return createErrorResult(`目标路径已存在: ${absoluteDest}。设置 overwrite=true 以覆盖。`);
                }

                // 确保目标目录存在
                const destDir = path.dirname(absoluteDest);
                if (!fs.existsSync(destDir)) {
                    fs.mkdirSync(destDir, { recursive: true });
                }

                fs.renameSync(absoluteSource, absoluteDest);

                return createSuccessResult(
                    createTextContent(`移动成功: ${absoluteSource} -> ${absoluteDest}`)
                );

            } catch (error: any) {
                logger.error(`Error moving ${sourcePath} to ${destPath}: ${error.message}`);
                return createErrorResult(error.message);
            }
        }
    });
}

/**
 * 复制文件的工具
 */
export function createCopyFileTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'copy_file',
        description: '复制文件。注意：源路径和目标路径都必须是绝对路径。',
        schema: z.object({
            sourcePath: z.string().describe('源文件的绝对路径'),
            destPath: z.string().describe('目标文件的绝对路径'),
            overwrite: z.boolean().optional().default(false).describe('如果目标已存在是否覆盖，默认为 false')
        }) as any,
        func: async ({ sourcePath, destPath, overwrite = false }: any): Promise<MCPToolResult> => {
            try {
                const sourceValidation = validatePath(sourcePath);
                if (!sourceValidation.valid) {
                    return createErrorResult(`源路径: ${sourceValidation.error}`);
                }

                const destValidation = validatePath(destPath);
                if (!destValidation.valid) {
                    return createErrorResult(`目标路径: ${destValidation.error}`);
                }

                const absoluteSource = sourceValidation.absolutePath!;
                const absoluteDest = destValidation.absolutePath!;

                if (!fs.existsSync(absoluteSource)) {
                    return createErrorResult(`源文件不存在: ${absoluteSource}`);
                }

                const stat = fs.statSync(absoluteSource);
                if (!stat.isFile()) {
                    return createErrorResult(`源路径不是文件: ${absoluteSource}`);
                }

                if (fs.existsSync(absoluteDest) && !overwrite) {
                    return createErrorResult(`目标文件已存在: ${absoluteDest}。设置 overwrite=true 以覆盖。`);
                }

                // 确保目标目录存在
                const destDir = path.dirname(absoluteDest);
                if (!fs.existsSync(destDir)) {
                    fs.mkdirSync(destDir, { recursive: true });
                }

                fs.copyFileSync(absoluteSource, absoluteDest);

                return createSuccessResult(
                    createTextContent(`复制成功: ${absoluteSource} -> ${absoluteDest}`)
                );

            } catch (error: any) {
                logger.error(`Error copying ${sourcePath} to ${destPath}: ${error.message}`);
                return createErrorResult(error.message);
            }
        }
    });
}

/**
 * 创建所有文件系统工具
 * @param config 文件系统工具配置
 */
export function createFileSystemTools(config: FileSystemToolsConfig = { maxFileSize: 10 * 1024 * 1024 }): StructuredToolInterface[] {
    return [
        // 基础读写
        createReadFileTool(config),
        createReadFileLinesTool(config),
        createWriteFileTool(),
        createAppendFileTool(),

        // 搜索和替换
        createReplaceInFileTool(config),
        createSearchInFileTool(config),
        createSearchFilesTool(),
        createGrepFilesTool(config),

        // 目录操作
        createListDirectoryTool(),
        createDirectoryTool(),
        createDeleteDirectoryTool(),

        // 文件操作
        createDeleteFileTool(),
        createMoveFileTool(),
        createCopyFileTool(),
        createFileExistsTool()
    ];
}
