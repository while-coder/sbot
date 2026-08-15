import fs from 'fs';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { createTextContent, createErrorResult, createSuccessResult, formatError, MCPToolResult } from 'scorpio.ai';
import { resolvePath } from '../utils';
import type { FileSystemToolRuntime } from '../runtime';

/** Remove files and directories, like bash rm */
export function createRmTool(runtime: FileSystemToolRuntime): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'rm',
        description: runtime.description,
        schema: z.object({
            paths: z.array(z.string()).min(1).describe('One or more absolute paths to remove'),
            recursive: z.boolean().optional().default(false).describe('Remove directories and their contents recursively (-r), default false'),
            force: z.boolean().optional().default(false).describe('Ignore nonexistent paths, never error (-f), default false'),
        }) as any,
        func: async ({ paths, recursive = false, force = false }: any): Promise<MCPToolResult> => {
            try {
                const results: string[] = [];

                for (const p of paths as string[]) {
                    const abs = resolvePath(p);

                    if (!fs.existsSync(abs)) {
                        if (force) continue;
                        return createErrorResult(`Path does not exist: ${abs}`);
                    }

                    const isDir = fs.statSync(abs).isDirectory();

                    if (isDir && !recursive) {
                        return createErrorResult(`${abs} is a directory. Set recursive=true to delete directories`);
                    }

                    fs.rmSync(abs, { recursive, force });
                    results.push(abs);
                }

                return createSuccessResult(createTextContent(
                    results.length > 0 ? `Removed:\n${results.join('\n')}` : 'No files removed'
                ));
            } catch (e: any) {
                runtime.logger?.error(`rm: ${formatError(e, true)}`);
                return createErrorResult(formatError(e));
            }
        }
    });
}
