import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { createErrorResult } from 'scorpio.ai';
import { loadPrompt } from '../../Core/PromptLoader';
import { resolveWorkingDir, runCommand } from './utils';

export function createShellTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'shell',
        description: loadPrompt('tools/command/shell.txt'),
        schema: z.object({
            command:    z.string().describe('Command or multi-line shell script to run, e.g. "git status", "npm install && npm run build", or a newline-separated script'),
            workingDir: z.string().describe('Absolute path of the working directory'),
            timeout:    z.number().optional().default(60000).describe('Timeout in milliseconds, default 60000 (60 s)'),
        }) as any,
        func: async ({ command, workingDir, timeout = 60000 }: any) => {
            const { cwd, error } = resolveWorkingDir(workingDir, workingDir);
            if (error) return createErrorResult(error);
            return runCommand(command, cwd!, timeout, `command "${command}"`);
        },
    });
}
