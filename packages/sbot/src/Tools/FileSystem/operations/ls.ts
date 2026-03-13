import fs from 'fs';
import path from 'path';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { checkDir } from '../utils';

const logger = LoggerService.getLogger('Tools/FileSystem/operations/ls.ts');

const IGNORE_PATTERNS = [
    'node_modules', '__pycache__', '.git', 'dist', 'build',
    'target', 'vendor', 'bin', 'obj', '.idea', '.vscode',
    '.zig-cache', 'zig-out', '.coverage', 'coverage',
    'tmp', 'temp', '.cache', 'cache', 'logs',
    '.venv', 'venv', 'env',
];

const LIMIT = 100;

/** 以树形文本列出目录结构，自动忽略常见构建/依赖目录 */
export function createLsTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'ls',
        description: `Lists files and directories in a given path as a tree. The path must be absolute. Automatically ignores common build/dependency directories (node_modules, .git, dist, build, etc.). You can optionally provide additional glob patterns to ignore.
You should generally prefer the grep_files or glob tools if you know which directories to search.`,
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

                const files: string[] = [];

                function walk(dir: string, rel: string) {
                    if (files.length >= LIMIT) return;
                    let entries: fs.Dirent[];
                    try {
                        entries = fs.readdirSync(dir, { withFileTypes: true });
                    } catch { return; }

                    for (const entry of entries) {
                        if (files.length >= LIMIT) break;
                        if (shouldIgnore(entry.name)) continue;
                        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
                        if (entry.isDirectory()) {
                            walk(path.join(dir, entry.name), relPath);
                        } else {
                            files.push(relPath);
                        }
                    }
                }

                walk(abs, '');

                const dirs = new Set<string>();
                const filesByDir = new Map<string, string[]>();

                for (const file of files) {
                    const dir = path.dirname(file).replace(/\\/g, '/');
                    const parts = dir === '.' ? [] : dir.split('/');
                    for (let i = 0; i <= parts.length; i++) {
                        dirs.add(i === 0 ? '.' : parts.slice(0, i).join('/'));
                    }
                    if (!filesByDir.has(dir)) filesByDir.set(dir, []);
                    filesByDir.get(dir)!.push(path.basename(file));
                }

                function renderDir(dirPath: string, depth: number): string {
                    const indent = '  '.repeat(depth);
                    let output = '';
                    if (depth > 0) output += `${indent}${path.basename(dirPath)}/\n`;
                    const childIndent = '  '.repeat(depth + 1);
                    const children = Array.from(dirs)
                        .filter(d => d.replace(/\\/g, '/') !== dirPath && path.dirname(d).replace(/\\/g, '/') === dirPath)
                        .sort();
                    for (const child of children) output += renderDir(child, depth + 1);
                    for (const file of (filesByDir.get(dirPath) || []).sort()) {
                        output += `${childIndent}${file}\n`;
                    }
                    return output;
                }

                const truncated = files.length >= LIMIT;
                const tree = `${abs}/\n` + renderDir('.', 0);
                const summary = truncated ? `\n(showing first ${LIMIT} files, results truncated)` : '';

                return createSuccessResult(createTextContent(tree + summary));
            } catch (e: any) {
                logger.error(`ls ${dirPath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}
