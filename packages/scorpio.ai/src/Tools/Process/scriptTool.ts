import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { z } from 'zod';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { createErrorResult, MCPToolResult } from '../types';
import { runProgram } from './runner';
import { resolveWorkingDir } from './paths';
import { isCommandAvailable } from './shell';
import { ShellManager, formatBackgroundResult } from './ShellManager';

const scriptCodeBaseSchema = z.object({
    code:       z.string().describe('Script source code to execute; written to a temp file automatically'),
    workingDir: z.string().describe('Absolute path of the working directory for the script'),
    args:       z.array(z.string()).optional().describe('Command-line arguments to pass to the script'),
    stdin:      z.any().optional().describe('Data to pipe into the script via stdin. Prefer a string; objects/arrays are auto-serialized to JSON.'),
});

export enum ScriptCodeMode {
    Sync = 'sync',
    Background = 'background',
}

export const scriptCodeSchema = z.discriminatedUnion('mode', [
    scriptCodeBaseSchema.extend({
        mode:    z.literal(ScriptCodeMode.Sync).describe('Run synchronously and return the final output in this tool call'),
        timeout: z.number().optional().default(60000).describe('Timeout in milliseconds, default 60000 (60 s)'),
    }),
    scriptCodeBaseSchema.extend({
        mode:    z.literal(ScriptCodeMode.Background).describe('Run in the background and use read_task for later output'),
        yieldMs: z.number().optional().default(1000).describe('How long to wait for immediate completion before returning a taskid, default 1000 ms'),
    }),
]);

type ScriptCodeInput = z.infer<typeof scriptCodeSchema>;

export interface ScriptCodeToolOptions {
    name:        string;
    description: string;
    interpreter: string;
    preArgs?:    string[];
    ext:         string;
}

export function createScriptCodeTool({ name, description, interpreter, preArgs = [], ext }: ScriptCodeToolOptions): StructuredToolInterface | null {
    if (!isCommandAvailable(interpreter)) return null;
    return new DynamicStructuredTool({
        name,
        description,
        schema: scriptCodeSchema as any,
        func: async (input: ScriptCodeInput): Promise<MCPToolResult> => {
            const { code, args = [], workingDir } = input;
            let { stdin } = input;
            // schema 用 z.any() 是为了同时满足两点：(1) Zod v4 的 toJSONSchema 不接受 transform/preprocess；
            // (2) 模型偶尔不遵守 string 约束、直接塞 object/array。这里在 func 入口统一序列化兜底。
            if (stdin != null && typeof stdin !== 'string') stdin = JSON.stringify(stdin);
            // 加随机后缀防止毫秒级并发同名碰撞导致互相 unlink。
            const tmpFile = path.join(os.tmpdir(), `sbot_script_${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`);
            try {
                await fs.promises.writeFile(tmpFile, code, 'utf8');
            } catch (e: any) {
                return createErrorResult(`Failed to write temp script: ${e?.message ?? e}`);
            }

            let cleanupByBackgroundManager = false;
            const cleanupTempFile = async () => {
                try { await fs.promises.unlink(tmpFile); } catch { /* ignore */ }
            };

            try {
                const { cwd, error: cwdError } = await resolveWorkingDir(workingDir);
                if (cwdError) return createErrorResult(cwdError);
                if (input.mode === ScriptCodeMode.Background) {
                    cleanupByBackgroundManager = true;
                    const result = await ShellManager.runProgram(
                        interpreter,
                        [...preArgs, tmpFile, ...args],
                        cwd!,
                        input.yieldMs ?? 1000,
                        name,
                        stdin,
                        cleanupTempFile,
                    );
                    return formatBackgroundResult(result);
                } else {
                    return await runProgram(interpreter, [...preArgs, tmpFile, ...args], cwd!, input.timeout ?? 60000, name, stdin);
                }
            } finally {
                if (!cleanupByBackgroundManager) await cleanupTempFile();
            }
        },
    });
}
