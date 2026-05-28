import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { createErrorResult } from 'scorpio.ai';
import { loadPrompt } from '../../Core/PromptLoader';
import { resolveWorkingDir, runShellCommand } from './utils';

export function createShellTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'shell',
        description: loadPrompt('tools/command/shell.txt'),
        schema: z.object({
            command:    z.string().min(1).describe('Command or multi-line shell script to run, e.g. "git status", "npm install && npm run build", or a newline-separated script'),
            workingDir: z.string().describe('Absolute path of the working directory'),
            stdin:      z.any().optional().describe('Data to pipe into the command via stdin. Prefer a string; objects/arrays are auto-serialized to JSON.'),
            timeout:    z.number().optional().default(60000).describe('Timeout in milliseconds, default 60000 (60 s)'),
        }) as any,
        func: async ({ command, workingDir, stdin, timeout = 60000 }: any) => {
            // schema 用 z.any() 是为了同时满足两点：(1) Zod v4 的 toJSONSchema 不接受 transform/preprocess；
            // (2) 模型偶尔不遵守 string 约束、直接塞 object/array。这里在 func 入口统一序列化兜底。
            if (stdin != null && typeof stdin !== 'string') stdin = JSON.stringify(stdin);
            const { cwd, error } = await resolveWorkingDir(workingDir);
            if (error) return createErrorResult(error);
            return runShellCommand(command, cwd!, timeout, `command "${command}"`, stdin);
        },
    });
}
