import fs from 'fs';
import { createAgentTool, type AgentTool } from "scorpio.ai";
import { z } from 'zod';
import { createTextContent, createErrorResult, createSuccessResult, formatError, MCPToolResult } from 'scorpio.ai';
import { resolvePath } from '../utils';
import type { FileSystemToolRuntime } from '../runtime';

/** Create directories, like bash mkdir */
export function createMkdirTool(runtime: FileSystemToolRuntime): AgentTool {
    return createAgentTool({
        name: 'mkdir',
        description: runtime.description,
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
                        return createErrorResult(`Directory already exists: ${abs}`);
                    }

                    fs.mkdirSync(abs, { recursive: parents });
                    results.push(abs);
                }

                return createSuccessResult(createTextContent(
                    results.length > 0 ? `Created:\n${results.join('\n')}` : 'No directories created'
                ));
            } catch (e: any) {
                runtime.logger?.error(`mkdir: ${formatError(e, true)}`);
                return createErrorResult(formatError(e));
            }
        }
    });
}
