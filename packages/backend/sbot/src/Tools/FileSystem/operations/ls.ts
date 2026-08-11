import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, formatError, MCPToolResult, formatWalkTree, DEFAULT_WALK_MAX_DEPTH, DEFAULT_WALK_LIMIT } from 'scorpio.ai';
import { checkDir } from '../utils';
import { loadPrompt } from '../../../Core/PromptLoader';

const logger = LoggerService.getLogger('Tools/FileSystem/operations/ls.ts');

const IGNORE_PATTERNS = new Set([
    'node_modules', '__pycache__', '.git', 'dist', 'build',
    'target', 'vendor', 'bin', 'obj', '.idea', '.vscode',
    '.zig-cache', 'zig-out', '.coverage', 'coverage',
    'tmp', 'temp', '.cache', 'cache', 'logs',
    '.venv', 'venv', 'env',
]);

/** 列出目录内容（扁平相对路径；目录加 `/` 后缀；自动忽略常见构建/依赖目录） */
export function createLsTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'ls',
        description: loadPrompt('tools/fs/ls.txt'),
        schema: z.object({
            dirPath: z.string().describe('Absolute path of the directory to list'),
            maxDepth: z.number().int().positive().optional().default(DEFAULT_WALK_MAX_DEPTH).describe(`Max recursion depth (1 = direct children only). Default ${DEFAULT_WALK_MAX_DEPTH}`),
            limit: z.number().int().positive().optional().default(DEFAULT_WALK_LIMIT).describe(`Stop after this many entries (files + directories). Default ${DEFAULT_WALK_LIMIT}`),
            ignore: z.array(z.string()).optional().describe('Additional directory/file names to ignore'),
        }) as any,
        func: async ({ dirPath, maxDepth = DEFAULT_WALK_MAX_DEPTH, limit = DEFAULT_WALK_LIMIT, ignore = [] }: any): Promise<MCPToolResult> => {
            try {
                const abs = checkDir(dirPath);
                const ignoreSet = new Set<string>([...IGNORE_PATTERNS, ...(ignore ?? [])]);
                return createSuccessResult(createTextContent(formatWalkTree(abs, { maxDepth, limit, ignore: ignoreSet })));
            } catch (e: any) {
                logger.error(`ls ${dirPath}: ${formatError(e, true)}`);
                return createErrorResult(formatError(e));
            }
        }
    });
}
