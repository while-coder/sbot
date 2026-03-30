import fs from 'fs';
import path from 'path';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { checkDir } from '../utils';
import { loadPrompt } from '../../../Core/PromptLoader';

const logger = LoggerService.getLogger('Tools/FileSystem/operations/ls.ts');

const IGNORE_PATTERNS = [
    'node_modules', '__pycache__', '.git', 'dist', 'build',
    'target', 'vendor', 'bin', 'obj', '.idea', '.vscode',
    '.zig-cache', 'zig-out', '.coverage', 'coverage',
    'tmp', 'temp', '.cache', 'cache', 'logs',
    '.venv', 'venv', 'env',
];

const LIMIT = 100;

interface TreeNode {
    name: string;
    isDir: boolean;
    children: TreeNode[];
}

/** 以树形文本列出目录结构，自动忽略常见构建/依赖目录 */
export function createLsTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'ls',
        description: loadPrompt('tools/fs/ls.txt'),
        schema: z.object({
            dirPath: z.string().describe('Absolute path of the directory to list'),
            ignore: z.array(z.string()).optional().describe('Additional directory/file names to ignore'),
        }) as any,
        func: async ({ dirPath, ignore = [] }: any): Promise<MCPToolResult> => {
            try {
                const abs = checkDir(dirPath);
                const extraIgnore: string[] = ignore ?? [];
                const shouldIgnore = (name: string) =>
                    IGNORE_PATTERNS.includes(name) || extraIgnore.includes(name);

                let fileCount = 0;
                let dirCount = 0;

                function walk(dir: string): TreeNode[] {
                    let entries: fs.Dirent[];
                    try {
                        entries = fs.readdirSync(dir, { withFileTypes: true });
                    } catch { return []; }

                    // 排序：目录在前，文件在后，各自按名称排序
                    entries.sort((a, b) => {
                        const aDir = a.isDirectory() ? 0 : 1;
                        const bDir = b.isDirectory() ? 0 : 1;
                        if (aDir !== bDir) return aDir - bDir;
                        return a.name.localeCompare(b.name);
                    });

                    const nodes: TreeNode[] = [];
                    for (const entry of entries) {
                        if (fileCount >= LIMIT) break;
                        if (shouldIgnore(entry.name)) continue;

                        if (entry.isDirectory()) {
                            dirCount++;
                            const children = fileCount < LIMIT
                                ? walk(path.join(dir, entry.name))
                                : [];
                            nodes.push({ name: entry.name, isDir: true, children });
                        } else {
                            fileCount++;
                            nodes.push({ name: entry.name, isDir: false, children: [] });
                        }
                    }
                    return nodes;
                }

                const tree = walk(abs);

                // 渲染树形结构
                const lines: string[] = [`${abs}/`];

                function render(nodes: TreeNode[], prefix: string) {
                    for (let i = 0; i < nodes.length; i++) {
                        const node = nodes[i];
                        const isLast = i === nodes.length - 1;
                        const connector = isLast ? '└── ' : '├── ';
                        const label = node.isDir ? `${node.name}/` : node.name;
                        lines.push(`${prefix}${connector}${label}`);

                        if (node.isDir && node.children.length > 0) {
                            const childPrefix = prefix + (isLast ? '    ' : '│   ');
                            render(node.children, childPrefix);
                        }
                    }
                }

                render(tree, '');

                // 汇总信息
                const parts: string[] = [];
                parts.push(`${dirCount} director${dirCount === 1 ? 'y' : 'ies'}`);
                parts.push(`${fileCount} file${fileCount === 1 ? '' : 's'}`);
                if (fileCount >= LIMIT) parts.push('truncated');
                lines.push('', parts.join(', '));

                return createSuccessResult(createTextContent(lines.join('\n')));
            } catch (e: any) {
                logger.error(`ls ${dirPath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}
