import fs from 'fs';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { resolvePath } from '../utils';

const logger = LoggerService.getLogger('Tools/FileSystem/operations/mkdir.ts');

/** Create directories, like bash mkdir */
export function createMkdirTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'mkdir',
        description: `Create directories, like bash mkdir. Supports multiple paths.
- Without parents=true: errors if the directory already exists or if parent directories are missing.
- parents=true (-p): creates all missing parent directories and silently succeeds if the directory already exists.
All paths must be absolute.`,
        schema: z.object({
            paths: z.array(z.string()).min(1).describe('One or more absolute directory paths to create'),
            parents: z.boolean().optional().default(false).describe('Create parent directories as needed, no error if exists (-p), default false'),
        }) as any,
        func: async ({ paths, parents = false }: any): Promise<MCPToolResult> => {
            try {
                const results: string[] = [];

                for (const p of paths as string[]) {
                    const abs = resolvePath(p);

                    if (fs.existsSync(abs)) {
                        if (parents) continue;
                        return createErrorResult(`目录已存在: ${abs}`);
                    }

                    fs.mkdirSync(abs, { recursive: parents });
                    results.push(abs);
                }

                return createSuccessResult(createTextContent(
                    results.length > 0 ? `已创建:\n${results.join('\n')}` : '无目录被创建'
                ));
            } catch (e: any) {
                logger.error(`mkdir: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}
