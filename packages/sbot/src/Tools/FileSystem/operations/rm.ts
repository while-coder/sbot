import fs from 'fs';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { resolvePath } from '../utils';

const logger = LoggerService.getLogger('Tools/FileSystem/operations/rm.ts');

/** Remove files and directories, like bash rm */
export function createRmTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'rm',
        description: `Remove files and directories, like bash rm. Supports multiple paths.
- Deleting a directory requires recursive=true (-r), otherwise returns an error.
- force=true (-f) silently ignores nonexistent paths instead of erroring.
All paths must be absolute.`,
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
                logger.error(`rm: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}
